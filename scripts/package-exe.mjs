import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const distDir = path.join(repoRoot, 'dist')
const packageSrcDir = path.join(distDir, 'package-src')
const appDir = path.join(packageSrcDir, 'app')
const publicDir = path.join(appDir, 'server', 'public')
const launcherSrcDir = path.join(distDir, 'launcher-src')
const launcherPublishDir = path.join(distDir, 'launcher-publish')
const launcherProjectPath = path.join(launcherSrcDir, 'CCodeViewerLauncher.csproj')
const launcherProgramPath = path.join(launcherSrcDir, 'Program.cs')
const payloadZipPath = path.join(launcherSrcDir, 'AppPayload.zip')
const packageOutput = path.join(distDir, 'ccode-viewer-win-x64.exe')
const buildInfoPath = path.join(distDir, 'BUILD-INFO.txt')
const buildId = `${(process.env.GITHUB_SHA || 'local').slice(0, 12)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const powershellCommand = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'

function quoteArg(arg) {
  const str = String(arg)
  return /[\s"]/u.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str
}

function run(command, args, options = {}) {
  const commandLine = [quoteArg(command), ...args.map(quoteArg)].join(' ')
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    ...options
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${commandLine} failed with exit code ${result.status}`)
  }
}

function shouldCopyServerPath(sourcePath) {
  const parts = sourcePath.split(path.sep)
  return !parts.includes('node_modules') && !parts.includes('__tests__')
}

function escapePowerShellLiteral(value) {
  return String(value).replace(/'/g, "''")
}

function createPayloadZip(sourceDir, zipPath) {
  const escapedSourceDir = escapePowerShellLiteral(sourceDir)
  const escapedZipPath = escapePowerShellLiteral(zipPath)
  const command = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `if (Test-Path -LiteralPath '${escapedZipPath}') { Remove-Item -LiteralPath '${escapedZipPath}' -Force }`,
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedSourceDir}', '${escapedZipPath}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`
  ].join('; ')

  run(powershellCommand, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command])
}

function getBuildInfo() {
  return [
    'Claude Code Viewer Windows package',
    `Build ID: ${buildId}`,
    `Built from: ${process.env.GITHUB_SHA || 'local-working-copy'}`,
    `Generated at: ${new Date().toISOString()}`,
    '',
    'Launch behavior:',
    '- Bundles a native Windows launcher with the app payload embedded inside it',
    '- Extracts the payload into %LOCALAPPDATA%\\ClaudeCodeViewer\\builds\\<build-id>',
    '- Starts the embedded Express server with a bundled Node runtime',
    '- Finds an available local port starting at 6173',
    '- Opens the default browser automatically'
  ].join('\n')
}

function getLauncherProjectContents() {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <AssemblyName>ccode-viewer-win-x64</AssemblyName>
    <RootNamespace>CCodeViewerLauncher</RootNamespace>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
  </PropertyGroup>

  <ItemGroup>
    <EmbeddedResource Include="AppPayload.zip" LogicalName="CCodeViewerLauncher.AppPayload.zip" />
  </ItemGroup>
</Project>
`
}

function getLauncherProgramContents() {
  return `using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

internal static class Program
{
    private const string BuildId = "${buildId}";
    private const string PayloadResourceName = "CCodeViewerLauncher.AppPayload.zip";

    private static int Main()
    {
        var installRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ClaudeCodeViewer");
        var runRoot = Path.Combine(installRoot, "run");
        Directory.CreateDirectory(runRoot);
        var bootstrapLogPath = Path.Combine(runRoot, "bootstrap.log");
        var noOpen = Environment.GetEnvironmentVariable("CCODE_VIEWER_NO_OPEN");

        try
        {
            if (TryReuseExistingInstance(runRoot, noOpen))
            {
                if (File.Exists(bootstrapLogPath))
                {
                    File.Delete(bootstrapLogPath);
                }

                return 0;
            }

            var buildRoot = Path.Combine(installRoot, "builds");
            Directory.CreateDirectory(buildRoot);

            var appRoot = Path.Combine(buildRoot, BuildId);
            EnsurePayloadExtracted(appRoot);
            CleanupOldBuilds(buildRoot);

            var stdoutLogPath = Path.Combine(runRoot, "stdout.log");
            var stderrLogPath = Path.Combine(runRoot, "stderr.log");
            var urlFilePath = Path.Combine(runRoot, "viewer-url.txt");
            var pidFilePath = Path.Combine(runRoot, "viewer.pid");

            if (File.Exists(urlFilePath)) File.Delete(urlFilePath);
            if (File.Exists(pidFilePath)) File.Delete(pidFilePath);

            var nodePath = Path.Combine(appRoot, "node.exe");
            var commandProcessor = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            var commandArguments =
                $"/c \\"\\"{nodePath}\\" server\\\\launcher.js 1>>\\"{stdoutLogPath}\\" 2>>\\"{stderrLogPath}\\"\\"";

            var startInfo = new ProcessStartInfo
            {
                FileName = commandProcessor,
                Arguments = commandArguments,
                WorkingDirectory = appRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            startInfo.Environment["CCODE_VIEWER_URL_FILE"] = urlFilePath;

            if (!string.IsNullOrWhiteSpace(noOpen))
            {
                startInfo.Environment["CCODE_VIEWER_NO_OPEN"] = noOpen;
            }

            using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start the Node launcher.");
            File.WriteAllText(pidFilePath, process.Id.ToString(CultureInfo.InvariantCulture));

            if (File.Exists(bootstrapLogPath))
            {
                File.Delete(bootstrapLogPath);
            }

            return 0;
        }
        catch (Exception ex)
        {
            File.WriteAllText(bootstrapLogPath, ex.ToString());
            return 1;
        }
    }

    private static bool TryReuseExistingInstance(string runRoot, string? noOpen)
    {
        var pidFilePath = Path.Combine(runRoot, "viewer.pid");
        if (!File.Exists(pidFilePath))
        {
            return false;
        }

        if (!int.TryParse(File.ReadAllText(pidFilePath).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid))
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(pid);
            if (process.HasExited || !string.Equals(process.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }
        catch
        {
            return false;
        }

        if (!string.Equals(noOpen, "1", StringComparison.Ordinal))
        {
            var existingUrl = WaitForExistingUrl(Path.Combine(runRoot, "viewer-url.txt"));
            if (!string.IsNullOrWhiteSpace(existingUrl))
            {
                OpenBrowser(existingUrl);
            }
        }

        return true;
    }

    private static string? WaitForExistingUrl(string urlFilePath)
    {
        for (var attempt = 0; attempt < 25; attempt++)
        {
            try
            {
                if (File.Exists(urlFilePath))
                {
                    var url = File.ReadAllText(urlFilePath).Trim();
                    if (!string.IsNullOrWhiteSpace(url))
                    {
                        return url;
                    }
                }
            }
            catch
            {
                // Ignore transient reads while the file is being written.
            }

            Thread.Sleep(200);
        }

        return null;
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private static void EnsurePayloadExtracted(string appRoot)
    {
        var launcherPath = Path.Combine(appRoot, "server", "launcher.js");
        var publicIndexPath = Path.Combine(appRoot, "server", "public", "index.html");
        var nodePath = Path.Combine(appRoot, "node.exe");

        if (File.Exists(launcherPath) && File.Exists(publicIndexPath) && File.Exists(nodePath))
        {
            return;
        }

        if (Directory.Exists(appRoot))
        {
            Directory.Delete(appRoot, recursive: true);
        }

        Directory.CreateDirectory(appRoot);

        using var payloadStream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName)
            ?? throw new InvalidOperationException($"Embedded payload '{PayloadResourceName}' was not found.");
        using var archive = new ZipArchive(payloadStream, ZipArchiveMode.Read);
        archive.ExtractToDirectory(appRoot, overwriteFiles: true);
    }

    private static void CleanupOldBuilds(string buildRoot)
    {
        var oldBuilds = Directory
            .GetDirectories(buildRoot)
            .Where(directory => !string.Equals(Path.GetFileName(directory), BuildId, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(Directory.GetLastWriteTimeUtc)
            .Skip(2);

        foreach (var oldBuild in oldBuilds)
        {
            try
            {
                Directory.Delete(oldBuild, recursive: true);
            }
            catch
            {
                // Ignore cleanup failures for in-use older builds.
            }
        }
    }
}
`
}

async function main() {
  const buildInfo = getBuildInfo()

  await rm(packageSrcDir, { recursive: true, force: true })
  await rm(launcherSrcDir, { recursive: true, force: true })
  await rm(launcherPublishDir, { recursive: true, force: true })
  await rm(packageOutput, { force: true })
  await rm(buildInfoPath, { force: true })
  await mkdir(publicDir, { recursive: true })
  await mkdir(launcherSrcDir, { recursive: true })

  await cp(path.join(repoRoot, 'server'), path.join(appDir, 'server'), {
    recursive: true,
    filter: shouldCopyServerPath
  })
  await cp(path.join(repoRoot, 'shared'), path.join(appDir, 'shared'), { recursive: true })
  await copyFile(process.execPath, path.join(appDir, 'node.exe'))
  await writeFile(path.join(appDir, 'BUILD-INFO.txt'), buildInfo)
  await writeFile(buildInfoPath, buildInfo)

  run(npmCommand, ['--prefix', path.join(appDir, 'server'), 'ci', '--omit=dev'])
  run(npmCommand, ['--prefix', 'viewer', 'run', 'build', '--', '--outDir', publicDir, '--emptyOutDir'])

  createPayloadZip(appDir, payloadZipPath)
  await writeFile(launcherProjectPath, getLauncherProjectContents())
  await writeFile(launcherProgramPath, getLauncherProgramContents())

  run('dotnet', [
    'publish',
    launcherProjectPath,
    '-c', 'Release',
    '-o', launcherPublishDir
  ])

  await copyFile(path.join(launcherPublishDir, 'ccode-viewer-win-x64.exe'), packageOutput)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
