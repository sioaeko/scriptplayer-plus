export interface EroScriptSearchResult {
  title: string
  url: string
  topicId: number
  creator: string
  createdAt: string
  excerpt: string
  hasDownload: boolean
}

export interface EroScriptsAuth {
  apiKey: string
  username: string
}

const BASE_URL = 'https://discuss.eroscripts.com'

function getAuthHeaders(auth?: EroScriptsAuth | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (auth?.apiKey && auth?.username) {
    headers['Api-Key'] = auth.apiKey
    headers['Api-Username'] = auth.username
  }
  return headers
}

/** Verify EroScripts API key credentials */
export async function verifyLogin(auth: EroScriptsAuth): Promise<{ valid: boolean; username: string }> {
  try {
    const response = await fetch(`${BASE_URL}/session/current.json`, {
      headers: getAuthHeaders(auth),
    })
    if (!response.ok) return { valid: false, username: '' }
    const data = await response.json()
    const username = data.current_user?.username || auth.username
    return { valid: true, username }
  } catch {
    return { valid: false, username: '' }
  }
}

/**
 * Search EroScripts forum for funscripts matching a video title.
 * Uses the Discourse search API.
 */
export async function searchEroScripts(
  query: string,
  auth?: EroScriptsAuth | null
): Promise<EroScriptSearchResult[]> {
  const cleanQuery = cleanVideoTitle(query)
  if (!cleanQuery) return []

  try {
    const encodedQuery = encodeURIComponent(cleanQuery + ' #scripts:free-scripts')
    const response = await fetch(`${BASE_URL}/search.json?q=${encodedQuery}`, {
      headers: getAuthHeaders(auth),
    })

    if (!response.ok) return []

    const data = await response.json()
    const topics = data.topics || []
    const posts = data.posts || []

    return topics.slice(0, 20).map((topic: any) => {
      const post = posts.find((p: any) => p.topic_id === topic.id)
      return {
        title: topic.title || '',
        url: `${BASE_URL}/t/${topic.slug}/${topic.id}`,
        topicId: topic.id,
        creator: post?.username || topic.created_by?.username || 'Unknown',
        createdAt: topic.created_at || '',
        excerpt: post?.blurb || '',
        hasDownload: true, // assume topics in scripts category have downloads
      }
    })
  } catch (err) {
    console.error('EroScripts search error:', err)
    return []
  }
}

/** Get download links from a topic (finds .funscript attachment URLs) */
export async function getTopicDownloadLinks(
  topicId: number,
  auth?: EroScriptsAuth | null
): Promise<Array<{ filename: string; url: string }>> {
  try {
    const response = await fetch(`${BASE_URL}/t/${topicId}.json`, {
      headers: getAuthHeaders(auth),
    })
    if (!response.ok) return []

    const data = await response.json()
    const posts = data.post_stream?.posts || []
    const links: Array<{ filename: string; url: string }> = []

    for (const post of posts) {
      // Check link_counts for attachment downloads
      if (post.link_counts) {
        for (const link of post.link_counts) {
          if (link.url && isFunscriptUrl(link.url)) {
            const filename = link.title || link.url.split('/').pop() || 'script.funscript'
            const fullUrl = link.url.startsWith('http') ? link.url : `${BASE_URL}${link.url}`
            links.push({ filename, url: fullUrl })
          }
        }
      }

      // Also parse cooked HTML for download links
      const cooked = post.cooked || ''
      const hrefRegex = /href="([^"]*\.(?:funscript|zip|7z|rar)[^"]*)"/gi
      let match
      while ((match = hrefRegex.exec(cooked)) !== null) {
        const url = match[1]
        const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`
        const filename = decodeURIComponent(fullUrl.split('/').pop() || 'script')
        if (!links.some((l) => l.url === fullUrl)) {
          links.push({ filename, url: fullUrl })
        }
      }
    }

    return links
  } catch (err) {
    console.error('Failed to get topic downloads:', err)
    return []
  }
}

function isFunscriptUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.includes('.funscript') ||
    lower.includes('.zip') ||
    lower.includes('.7z') ||
    lower.includes('.rar') ||
    lower.includes('/uploads/')
  )
}

/** Download a file from EroScripts */
export async function downloadFile(
  url: string,
  auth?: EroScriptsAuth | null
): Promise<Blob | null> {
  try {
    const response = await fetch(url, {
      headers: auth?.apiKey
        ? { 'Api-Key': auth.apiKey, 'Api-Username': auth.username }
        : {},
    })
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}

/** Clean video filename into a searchable title */
function cleanVideoTitle(filename: string): string {
  let title = filename
    .replace(/\.[^.]+$/, '')
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd|hd)\b/gi, '')
    .replace(/\b(mp4|mkv|avi|webm|wmv|mp3|wav|flac|m4a|aac|ogg|opus|wma)\b/gi, '')
    .replace(/\b(xxx|porn)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = title.split(' ').filter((w) => w.length > 1)
  return words.slice(0, 6).join(' ')
}

/** Open a URL in the default browser */
export function openInBrowser(url: string) {
  window.open(url, '_blank')
}
