async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Fetch error')
  return res.json()
}

function el(tag, txt) { const e = document.createElement(tag); if (txt) e.textContent = txt; return e }

async function loadProjects() {
  const container = document.getElementById('projects')
  container.innerHTML = 'Loading...'
  try {
    const projects = await fetchJSON('/api/projects')
    container.innerHTML = ''
    projects.forEach(p => {
      const b = el('button', `${p.name} (${p.sessionCount})`)
      b.style.display = 'block'
      b.onclick = () => loadSessions(p.name)
      container.appendChild(b)
    })
    if (projects.length === 0) container.textContent = 'No projects found'
  } catch (e) { container.textContent = 'Error loading projects' }
}

async function loadSessions(projectName) {
  const container = document.getElementById('sessions')
  container.innerHTML = 'Loading...'
  try {
    const sessions = await fetchJSON(`/api/sessions?project=${encodeURIComponent(projectName)}`)
    container.innerHTML = ''
    sessions.forEach(s => {
      const btn = el('button', `${s.id} — ${s.messageCount} msgs`)
      btn.style.display = 'block'
      btn.onclick = () => loadSessionMessages(s.filePath)
      const meta = el('div', s.preview || '')
      meta.style.fontSize = '12px'
      container.appendChild(btn)
      container.appendChild(meta)
    })
    if (sessions.length === 0) container.textContent = 'No sessions'
  } catch (e) { container.textContent = 'Error loading sessions' }
}

async function loadSessionMessages(filePath) {
  const userList = document.getElementById('userList')
  const assistantList = document.getElementById('assistantList')
  userList.innerHTML = 'Loading...'
  assistantList.innerHTML = 'Select a user message'
  try {
    const mapping = await fetchJSON(`/api/session-mapping?file=${encodeURIComponent(filePath)}`)
    userList.innerHTML = ''
    assistantList.innerHTML = 'Select a user message'

    if (!mapping || !mapping.users || mapping.users.length === 0) {
      userList.textContent = 'No user messages found'
      return
    }

    mapping.users.forEach(u => {
      const btn = el('button', `${u.preview.substring(0,100)}${u.preview.length>100? '…':''}`)
      btn.style.display = 'block'
      btn.onclick = () => {
        renderAssistantList(u.id, mapping.mapping)
      }
      userList.appendChild(btn)
    })
  } catch (e) { userList.textContent = 'Error loading messages' }
}

function renderAssistantList(userId, mapping) {
  const assistantList = document.getElementById('assistantList')
  assistantList.innerHTML = ''
  const arr = mapping[userId] || mapping['__no_user__'] || []
  if (arr.length === 0) {
    assistantList.textContent = 'No assistant replies for this message'
    return
  }
  arr.forEach(a => {
    const box = document.createElement('div')
    box.style.borderBottom = '1px solid #eee'
    box.style.padding = '8px'
    const who = el('div', (a.timestamp||'') )
    who.style.fontWeight = '600'
    const content = el('pre', JSON.stringify(a.content || a.raw || a, null, 2))
    box.appendChild(who)
    box.appendChild(content)
    assistantList.appendChild(box)
  })
}

loadProjects()
