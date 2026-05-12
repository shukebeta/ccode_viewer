import { existsSync } from 'node:fs'
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
const launcherProjectPath = path.join(launcherSrcDir, 'RewindLauncher.csproj')
const launcherProgramPath = path.join(launcherSrcDir, 'Program.cs')
const launcherIconPath = path.join(launcherSrcDir, 'icon.ico')
const payloadZipPath = path.join(launcherSrcDir, 'AppPayload.zip')
const packageOutput = path.join(distDir, 'rewind-win-x64.exe')
const buildInfoPath = path.join(distDir, 'BUILD-INFO.txt')
const appIconSourcePath = path.join(repoRoot, 'src-tauri', 'icons', 'icon.ico')
const buildId = `${(process.env.GITHUB_SHA || 'local').slice(0, 12)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const powershellCommand = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const webView2Version = '1.0.3912.50'

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

function commandExists(command) {
  const commandLine = [quoteArg(command), '--version'].join(' ')
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: true
  })

  return !result.error && result.status === 0
}

function getPackageManager(projectDir) {
  if (existsSync(path.join(projectDir, 'pnpm-lock.yaml')) && commandExists(pnpmCommand)) {
    return 'pnpm'
  }

  return 'npm'
}

function installServerDependencies(serverDir) {
  if (getPackageManager(serverDir) === 'pnpm') {
    run(pnpmCommand, [
      '--dir',
      serverDir,
      'install',
      '--prod',
      '--frozen-lockfile',
      '--config.node-linker=hoisted',
      '--config.package-import-method=copy'
    ])
    return
  }

  const hasPackageLock = existsSync(path.join(serverDir, 'package-lock.json'))
  const args = ['--prefix', serverDir, hasPackageLock ? 'ci' : 'install', '--omit=dev']

  if (!hasPackageLock) {
    args.push('--no-package-lock')
  }

  run(npmCommand, args)
}

function buildViewer(outputDir) {
  const viewerDir = path.join(repoRoot, 'viewer')

  if (getPackageManager(viewerDir) === 'pnpm') {
    run(pnpmCommand, ['--dir', viewerDir, 'exec', 'vite', 'build', '--outDir', outputDir, '--emptyOutDir'])
  } else {
    run(npmCommand, ['--prefix', viewerDir, 'exec', '--', 'vite', 'build', '--outDir', outputDir, '--emptyOutDir'])
  }

  const indexPath = path.join(outputDir, 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(`Viewer build did not produce ${indexPath}. Refusing to package stale assets.`)
  }
}

function shouldCopyServerPath(sourcePath) {
  const parts = sourcePath.split(path.sep)
  return !parts.includes('node_modules') && !parts.includes('__tests__') && !parts.includes('public')
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
    'Rewind — Navigate and explore your AI coding sessions',
    `Build ID: ${buildId}`,
    `Built from: ${process.env.GITHUB_SHA || 'local-working-copy'}`,
    `Generated at: ${new Date().toISOString()}`,
    '',
    'Launch behavior:',
    '- Bundles a native Windows desktop host with the app payload embedded inside it',
    '- Extracts the payload into %LOCALAPPDATA%\\Rewind\\builds\\<build-id>',
    '- Starts the embedded Express server as a child Node process',
    '- Renders the UI in an embedded WebView2 desktop window',
    '- Closing the desktop window shuts down the child server process'
  ].join('\n')
}

function getLauncherProjectContents() {
  return String.raw`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <AssemblyName>rewind-win-x64</AssemblyName>
    <RootNamespace>RewindLauncher</RootNamespace>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <ApplicationIcon>icon.ico</ApplicationIcon>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Web.WebView2" Version="${webView2Version}" />
    <EmbeddedResource Include="AppPayload.zip" LogicalName="RewindLauncher.AppPayload.zip" />
  </ItemGroup>
</Project>
`
}

function getLauncherProgramContents() {
  return String.raw`using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    private const string BuildId = "__BUILD_ID__";
    private const string PayloadResourceName = "RewindLauncher.AppPayload.zip";

    [STAThread]
    private static int Main()
    {
        ApplicationConfiguration.Initialize();

        using var runtime = LauncherRuntime.Create(BuildId);

        try
        {
            runtime.EnsurePayloadExtracted();
            runtime.CleanupOldBuilds();
            runtime.CleanupOldRunDirectories();

            using var form = new HostForm(runtime);
            Application.Run(form);
            return 0;
        }
        catch (Exception ex)
        {
            runtime.WriteBootstrapLog(ex);
            MessageBox.Show(
                "Rewind failed to start.\r\n\r\n" + ex.Message + "\r\n\r\nLogs: " + runtime.InstanceRunRoot,
                "Rewind",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed class LauncherRuntime : IDisposable
{
    private const int UrlWaitAttempts = 150;
    private static readonly TimeSpan UrlWaitDelay = TimeSpan.FromMilliseconds(200);
    private const string PayloadResourceName = "RewindLauncher.AppPayload.zip";

    public string InstallRoot { get; }
    public string BuildRoot { get; }
    public string AppRoot { get; }
    public string RunRoot { get; }
    public string InstanceId { get; }
    public string InstanceRunRoot { get; }
    public string StdoutLogPath { get; }
    public string StderrLogPath { get; }
    public string UrlFilePath { get; }
    public string PidFilePath { get; }
    public string BootstrapLogPath { get; }
    public string LatestInstancePath { get; }

    private StreamWriter? _stdoutWriter;
    private StreamWriter? _stderrWriter;
    private bool _disposed;

    public Process? NodeProcess { get; private set; }

    private LauncherRuntime(string buildId)
    {
        InstallRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Rewind");
        BuildRoot = Path.Combine(InstallRoot, "builds");
        AppRoot = Path.Combine(BuildRoot, buildId);
        RunRoot = Path.Combine(InstallRoot, "run");
        InstanceId = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture) + "-" + Environment.ProcessId.ToString(CultureInfo.InvariantCulture);
        InstanceRunRoot = Path.Combine(RunRoot, InstanceId);
        StdoutLogPath = Path.Combine(InstanceRunRoot, "stdout.log");
        StderrLogPath = Path.Combine(InstanceRunRoot, "stderr.log");
        UrlFilePath = Path.Combine(InstanceRunRoot, "viewer-url.txt");
        PidFilePath = Path.Combine(InstanceRunRoot, "viewer.pid");
        BootstrapLogPath = Path.Combine(InstanceRunRoot, "bootstrap.log");
        LatestInstancePath = Path.Combine(RunRoot, "latest-instance.txt");
    }

    public static LauncherRuntime Create(string buildId)
    {
        var runtime = new LauncherRuntime(buildId);
        Directory.CreateDirectory(runtime.BuildRoot);
        Directory.CreateDirectory(runtime.RunRoot);
        Directory.CreateDirectory(runtime.InstanceRunRoot);
        File.WriteAllText(runtime.LatestInstancePath, runtime.InstanceRunRoot);
        return runtime;
    }

    public void EnsurePayloadExtracted()
    {
        var launcherPath = Path.Combine(AppRoot, "server", "launcher.js");
        var publicIndexPath = Path.Combine(AppRoot, "server", "public", "index.html");
        var nodePath = Path.Combine(AppRoot, "node.exe");

        if (File.Exists(launcherPath) && File.Exists(publicIndexPath) && File.Exists(nodePath))
        {
            return;
        }

        if (Directory.Exists(AppRoot))
        {
            Directory.Delete(AppRoot, recursive: true);
        }

        Directory.CreateDirectory(AppRoot);

        using var payloadStream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName)
            ?? throw new InvalidOperationException($"Embedded payload '{PayloadResourceName}' was not found.");
        using var archive = new ZipArchive(payloadStream, ZipArchiveMode.Read);
        archive.ExtractToDirectory(AppRoot, overwriteFiles: true);
    }

    public void CleanupOldBuilds()
    {
        var oldBuilds = Directory
            .GetDirectories(BuildRoot)
            .Where(directory => !string.Equals(Path.GetFileName(directory), Path.GetFileName(AppRoot), StringComparison.OrdinalIgnoreCase))
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

    public void CleanupOldRunDirectories()
    {
        var oldRunDirectories = Directory
            .GetDirectories(RunRoot)
            .Where(directory => !string.Equals(directory, InstanceRunRoot, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(Directory.GetLastWriteTimeUtc)
            .Skip(5);

        foreach (var oldRunDirectory in oldRunDirectories)
        {
            try
            {
                Directory.Delete(oldRunDirectory, recursive: true);
            }
            catch
            {
                // Ignore cleanup failures for in-use older runs.
            }
        }
    }

    public void StartNodeProcess()
    {
        if (NodeProcess != null)
        {
            return;
        }

        _stdoutWriter = new StreamWriter(new FileStream(StdoutLogPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
        {
            AutoFlush = true
        };
        _stderrWriter = new StreamWriter(new FileStream(StderrLogPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
        {
            AutoFlush = true
        };

        var nodePath = Path.Combine(AppRoot, "node.exe");
        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = @"server\launcher.js",
            WorkingDirectory = AppRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        startInfo.Environment["CCODE_VIEWER_NO_OPEN"] = "1";
        startInfo.Environment["CCODE_VIEWER_URL_FILE"] = UrlFilePath;

        var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data != null)
            {
                _stdoutWriter?.WriteLine(args.Data);
            }
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data != null)
            {
                _stderrWriter?.WriteLine(args.Data);
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        NodeProcess = process;
        File.WriteAllText(PidFilePath, process.Id.ToString(CultureInfo.InvariantCulture));
    }

    public async Task<string> WaitForUrlAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < UrlWaitAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (File.Exists(UrlFilePath))
            {
                var url = File.ReadAllText(UrlFilePath).Trim();
                if (!string.IsNullOrWhiteSpace(url))
                {
                    return url;
                }
            }

            if (NodeProcess is { HasExited: true })
            {
                throw new InvalidOperationException($"The embedded server exited early. See {StderrLogPath}.");
            }

            await Task.Delay(UrlWaitDelay, cancellationToken);
        }

        throw new TimeoutException($"Timed out waiting for the local viewer URL. See {StdoutLogPath} and {StderrLogPath}.");
    }

    public void StopNodeProcess()
    {
        if (NodeProcess != null)
        {
            try
            {
                if (!NodeProcess.HasExited)
                {
                    NodeProcess.Kill(entireProcessTree: true);
                    NodeProcess.WaitForExit(5000);
                }
            }
            catch
            {
                // Ignore shutdown failures; the process may already be gone.
            }
            finally
            {
                NodeProcess.Dispose();
                NodeProcess = null;
            }
        }

        DisposeWriters();
    }

    public void WriteBootstrapLog(Exception ex)
    {
        File.WriteAllText(BootstrapLogPath, ex.ToString());
        File.WriteAllText(LatestInstancePath, InstanceRunRoot);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopNodeProcess();
    }

    private void DisposeWriters()
    {
        _stdoutWriter?.Dispose();
        _stderrWriter?.Dispose();
        _stdoutWriter = null;
        _stderrWriter = null;
    }
}

internal sealed class HostForm : Form
{
    private readonly LauncherRuntime _runtime;
    private readonly CancellationTokenSource _startupCancellation = new();
    private readonly Button _openBrowserButton;
    private readonly System.Windows.Forms.Timer _hoverTimer;
    private readonly Label _statusLabel;
    private readonly WebView2 _webView;

    private string? _currentUrl;

    public HostForm(LauncherRuntime runtime)
    {
        _runtime = runtime;

        Text = "Rewind — Navigate and explore your AI coding sessions";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Width = 1440;
        Height = 920;
        MinimumSize = new Size(1024, 720);
        StartPosition = FormStartPosition.CenterScreen;

        _openBrowserButton = new Button
        {
            Text = "Open in Browser",
            AutoSize = true,
            Enabled = false,
            Visible = false,
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        _openBrowserButton.Click += (_, _) => OpenInBrowser();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill
        };

        _statusLabel = new Label
        {
            Dock = DockStyle.Fill,
            Text = "Starting Rewind...",
            TextAlign = ContentAlignment.MiddleCenter
        };

        Controls.Add(_webView);
        Controls.Add(_statusLabel);
        Controls.Add(_openBrowserButton);
        _openBrowserButton.BringToFront();
        _statusLabel.BringToFront();

        _hoverTimer = new System.Windows.Forms.Timer
        {
            Interval = 150
        };
        _hoverTimer.Tick += (_, _) => UpdateOpenBrowserButtonVisibility();
        _hoverTimer.Start();

        Resize += (_, _) => PositionOpenBrowserButton();
        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, _) =>
        {
            _startupCancellation.Cancel();
            _hoverTimer.Stop();
            _hoverTimer.Dispose();
            _runtime.Dispose();
        };

        PositionOpenBrowserButton();
    }

    private async Task StartAsync()
    {
        try
        {
            _statusLabel.Text = "Starting local server...";
            _runtime.StartNodeProcess();

            _currentUrl = await _runtime.WaitForUrlAsync(_startupCancellation.Token);

            _statusLabel.Text = "Loading viewer...";
            await _webView.EnsureCoreWebView2Async();

            if (_webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            }

            _webView.Source = new Uri(_currentUrl);
            _webView.Visible = true;
            _statusLabel.Visible = false;
            _openBrowserButton.Enabled = true;
            PositionOpenBrowserButton();
            UpdateOpenBrowserButtonVisibility();
        }
        catch (TaskCanceledException)
        {
            // Ignore cancellation during shutdown.
        }
        catch (WebView2RuntimeNotFoundException)
        {
            HandleStartupFailure(new InvalidOperationException(
                "Microsoft Edge WebView2 Runtime is required for the packaged desktop viewer. Install it and try again."));
        }
        catch (Exception ex)
        {
            HandleStartupFailure(ex);
        }
    }

    private void HandleStartupFailure(Exception ex)
    {
        _runtime.WriteBootstrapLog(ex);
        MessageBox.Show(
            this,
            "Claude Code Viewer failed to start.\r\n\r\n" + ex.Message + "\r\n\r\nLogs: " + _runtime.InstanceRunRoot,
            "Claude Code Viewer",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
        Close();
    }

    private void PositionOpenBrowserButton()
    {
        var margin = 16;
        var x = Math.Max(margin, ClientSize.Width - _openBrowserButton.Width - margin);
        _openBrowserButton.Location = new Point(x, margin);
    }

    private void UpdateOpenBrowserButtonVisibility()
    {
        if (!_openBrowserButton.Enabled)
        {
            _openBrowserButton.Visible = false;
            return;
        }

        var shouldShow = Bounds.Contains(Cursor.Position);
        _openBrowserButton.Visible = shouldShow;

        if (shouldShow)
        {
            _openBrowserButton.BringToFront();
        }
    }

    private void OpenInBrowser()
    {
        if (string.IsNullOrWhiteSpace(_currentUrl))
        {
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = _currentUrl,
            UseShellExecute = true
        });
    }
}
`.replace('__BUILD_ID__', buildId)
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
  await copyFile(appIconSourcePath, launcherIconPath)
  await writeFile(path.join(appDir, 'BUILD-INFO.txt'), buildInfo)
  await writeFile(buildInfoPath, buildInfo)

  installServerDependencies(path.join(appDir, 'server'))
  buildViewer(publicDir)

  createPayloadZip(appDir, payloadZipPath)
  await writeFile(launcherProjectPath, getLauncherProjectContents())
  await writeFile(launcherProgramPath, getLauncherProgramContents())

  run('dotnet', [
    'publish',
    launcherProjectPath,
    '-c', 'Release',
    '-o', launcherPublishDir
  ])

  await copyFile(path.join(launcherPublishDir, 'rewind-win-x64.exe'), packageOutput)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
