import { useState, useEffect } from 'react'
import {
  Search,
  ExternalLink,
  RefreshCw,
  Download,
  LogIn,
  LogOut,
  User,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useTranslation } from '../i18n'

const BASE_URL = 'https://discuss.eroscripts.com'

interface EroScriptSearchResult {
  title: string
  url: string
  topicId: number
  creator: string
  createdAt: string
}

interface EroScriptsPanelProps {
  currentVideoName: string | null
}

export default function EroScriptsPanel({ currentVideoName }: EroScriptsPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EroScriptSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [expandedTopic, setExpandedTopic] = useState<number | null>(null)
  const [downloadLinks, setDownloadLinks] = useState<Record<number, Array<{ filename: string; url: string }>>>({})
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())

  // Restore session on mount
  useEffect(() => {
    window.electronAPI.eroscriptsCheckSession().then(result => {
      if (result.loggedIn) {
        setLoggedIn(true)
        setUsername(result.username)
      }
    })
  }, [])

  useEffect(() => {
    if (currentVideoName) {
      const cleaned = currentVideoName
        .replace(/\.[^.]+$/, '')
        .replace(/[._-]+/g, ' ')
        .trim()
      setQuery(cleaned)
    }
  }, [currentVideoName])

  const handleLogin = async () => {
    setLoggingIn(true)
    const result = await window.electronAPI.eroscriptsLogin()
    if (result.success) {
      setLoggedIn(true)
      setUsername(result.username)
      localStorage.setItem('eroUsername', result.username)
    }
    setLoggingIn(false)
  }

  const handleLogout = async () => {
    await window.electronAPI.eroscriptsLogout()
    setLoggedIn(false)
    setUsername('')
    localStorage.removeItem('eroUsername')
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)

    const cleanQuery = cleanVideoTitle(query)
    const encodedQuery = encodeURIComponent(cleanQuery + ' #scripts:free-scripts')
    const resp = await window.electronAPI.eroscriptsFetch(`${BASE_URL}/search.json?q=${encodedQuery}`)

    if (resp.ok && resp.data) {
      const topics = resp.data.topics || []
      const posts = resp.data.posts || []
      setResults(
        topics.slice(0, 20).map((topic: any) => {
          const post = posts.find((p: any) => p.topic_id === topic.id)
          return {
            title: topic.title || '',
            url: `${BASE_URL}/t/${topic.slug}/${topic.id}`,
            topicId: topic.id,
            creator: post?.username || 'Unknown',
            createdAt: topic.created_at || '',
          }
        })
      )
    } else {
      setResults([])
    }
    setLoading(false)
  }

  const handleExpandTopic = async (topicId: number) => {
    if (expandedTopic === topicId) {
      setExpandedTopic(null)
      return
    }
    setExpandedTopic(topicId)
    if (!downloadLinks[topicId]) {
      const resp = await window.electronAPI.eroscriptsFetch(`${BASE_URL}/t/${topicId}.json`)
      if (resp.ok && resp.data) {
        const posts = resp.data.post_stream?.posts || []
        const links: Array<{ filename: string; url: string }> = []

        for (const post of posts) {
          if (post.link_counts) {
            for (const link of post.link_counts) {
              if (link.url && isFunscriptUrl(link.url)) {
                const rawName = link.title || link.url.split('/').pop() || 'script.funscript'
                const filename = safeDecodeURI(rawName)
                const fullUrl = link.url.startsWith('http') ? link.url : `${BASE_URL}${link.url}`
                links.push({ filename, url: fullUrl })
              }
            }
          }
          const cooked = post.cooked || ''
          const hrefRegex = /href="([^"]*\.(?:funscript|zip|7z|rar)[^"]*)"/gi
          let match
          while ((match = hrefRegex.exec(cooked)) !== null) {
            const url = match[1]
            const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`
            const filename = safeDecodeURI(fullUrl.split('/').pop() || 'script')
            if (!links.some(l => l.url === fullUrl)) {
              links.push({ filename, url: fullUrl })
            }
          }
        }
        setDownloadLinks(prev => ({ ...prev, [topicId]: links }))
      }
    }
  }

  const handleDownload = async (url: string, filename: string) => {
    if (!loggedIn) {
      handleLogin()
      return
    }
    setDownloading(url)
    const result = await window.electronAPI.eroscriptsDownload(url)
    if (result.ok) {
      setDownloaded(prev => new Set(prev).add(url))
    }
    setDownloading(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Auth status bar */}
      <div className="px-3 py-2 border-b border-surface-100/20">
        {loggedIn ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <User size={12} className="text-green-400" />
              <span className="text-[10px] text-green-400">{username}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-[10px] text-text-muted hover:text-red-400 transition-colors flex items-center gap-1"
            >
              <LogOut size={10} />
              {t('eroscripts.logout')}
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            disabled={loggingIn}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
          >
            {loggingIn ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <LogIn size={12} />
            )}
            {loggingIn ? t('device.connecting') : 'EroScripts 로그인'}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="p-2 space-y-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder={t('eroscripts.search')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-2.5 py-1.5 bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
        {currentVideoName && (
          <button
            onClick={handleSearch}
            className="w-full text-[10px] text-accent/70 hover:text-accent transition-colors text-left px-1"
          >
            {t('eroscripts.autoSearch')}
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw size={20} className="animate-spin text-accent/50" />
          </div>
        ) : results.length > 0 ? (
          results.map(result => (
            <div key={result.topicId} className="mb-0.5">
              <button
                onClick={() => handleExpandTopic(result.topicId)}
                className="w-full text-left px-3 py-2.5 rounded-md hover:bg-surface-100/30 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-text-primary leading-relaxed group-hover:text-accent transition-colors line-clamp-2 flex-1">
                    {result.title}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        window.open(result.url, '_blank')
                      }}
                      className="p-0.5 text-text-muted hover:text-accent"
                    >
                      <ExternalLink size={11} />
                    </button>
                    {expandedTopic === result.topicId ? (
                      <ChevronUp size={12} className="text-text-muted" />
                    ) : (
                      <ChevronDown size={12} className="text-text-muted" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-text-muted">{result.creator}</span>
                  {result.createdAt && (
                    <span className="text-[10px] text-text-muted">
                      {new Date(result.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </button>

              {expandedTopic === result.topicId && (
                <div className="px-3 pb-2 space-y-1">
                  {downloadLinks[result.topicId] ? (
                    downloadLinks[result.topicId].length > 0 ? (
                      downloadLinks[result.topicId].map(link => (
                        <button
                          key={link.url}
                          onClick={() => handleDownload(link.url, link.filename)}
                          disabled={downloading === link.url}
                          className="w-full flex items-center gap-2 px-2 py-1.5 bg-surface-300/50 hover:bg-surface-100/30 rounded text-[10px] transition-colors disabled:opacity-50"
                        >
                          {downloaded.has(link.url) ? (
                            <Check size={11} className="text-green-400 flex-shrink-0" />
                          ) : downloading === link.url ? (
                            <RefreshCw size={11} className="animate-spin text-accent flex-shrink-0" />
                          ) : (
                            <Download size={11} className="text-accent flex-shrink-0" />
                          )}
                          <span className="text-text-secondary truncate">{link.filename}</span>
                        </button>
                      ))
                    ) : (
                      <div className="text-[10px] text-text-muted px-2 py-1">
                        {loggedIn ? t('eroscripts.noResults') : t('eroscripts.loginRequired')}
                      </div>
                    )
                  ) : (
                    <div className="flex items-center justify-center py-2">
                      <RefreshCw size={12} className="animate-spin text-text-muted" />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        ) : searched ? (
          <div className="text-text-muted text-xs text-center py-8">{t('eroscripts.noResults')}</div>
        ) : (
          <div className="text-text-muted text-xs text-center py-8 px-4 leading-relaxed">
            {t('eroscripts.description')}
          </div>
        )}
      </div>
    </div>
  )
}

function cleanVideoTitle(filename: string): string {
  let title = filename
    .replace(/\.[^.]+$/, '')
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd|hd)\b/gi, '')
    .replace(/\b(mp4|mkv|avi|webm|wmv)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = title.split(' ').filter(w => w.length > 1)
  return words.slice(0, 6).join(' ')
}

function safeDecodeURI(str: string): string {
  try { return decodeURIComponent(str) } catch { return str }
}

function isFunscriptUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('.funscript') || lower.includes('.zip') || lower.includes('.7z') || lower.includes('.rar') || lower.includes('/uploads/')
}
