import { Client } from 'ldapts'

export interface LdapUser {
  username: string
  email?: string
  displayName?: string
  groups: string[]
}

const env = (key: string, fallback?: string) =>
  (process.env[key] ?? fallback)?.toString()

const enabled = () => env('LDAP_ENABLED', 'false') === 'true'
const debug = () => env('LDAP_DEBUG', 'false') === 'true'

const getConfig = () => ({
  url: env('LDAP_URL', ''),
  domain: env('LDAP_DOMAIN', ''),
  searchBase: env('LDAP_SEARCH_BASE', ''),
  searchFilter: env('LDAP_SEARCH_FILTER', '(sAMAccountName={{username}})'),
  emailAttr: env('LDAP_EMAIL_ATTR', 'mail'),
  nameAttr: env('LDAP_NAME_ATTR', 'cn'),
  groupAttr: env('LDAP_GROUP_ATTR', 'memberOf'),
  timeoutMs: Number(env('LDAP_TIMEOUT_MS', '8000')),
})

const bindUser = (domain: string, username: string) =>
  domain ? `${domain}\\${username}` : username

const parseGroups = (raw: string | string[] | undefined) => {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((dn) => {
      const match = /CN=([^,]+)/i.exec(dn)
      return match ? match[1] : dn
    })
    .filter(Boolean)
}

export async function ldapAuthenticate(username: string, password: string): Promise<LdapUser | null> {
  if (!enabled()) return null
  const normalizedUsername = username.trim().toUpperCase()
  const { url, domain, searchBase, searchFilter, emailAttr, nameAttr, groupAttr, timeoutMs } =
    getConfig()
  if (!url || !searchBase) return null

  const client = new Client({ url, timeout: timeoutMs, connectTimeout: timeoutMs })

  try {
    await client.bind(bindUser(domain, normalizedUsername), password)

    const filter = searchFilter.replace('{{username}}', normalizedUsername)
    const result = await client.search(searchBase, {
      scope: 'sub',
      filter,
      sizeLimit: 1,
      attributes: [emailAttr, nameAttr, groupAttr],
    })

    if (result.searchEntries.length === 0) return null
    const entry = result.searchEntries[0] as Record<string, string | string[]>
    const rawEmail = entry[emailAttr]
    const rawName = entry[nameAttr]
    const rawGroups = entry[groupAttr]
    const email = Array.isArray(rawEmail) ? rawEmail[0] : rawEmail
    const displayName = Array.isArray(rawName) ? rawName[0] : rawName
    const groups = parseGroups(rawGroups)

    return { username: normalizedUsername, email, displayName, groups }
  } catch (err) {
    if (debug()) {
      // eslint-disable-next-line no-console
      console.error('LDAP auth error:', err)
    }
    return null
  } finally {
    try {
      await client.unbind()
    } catch {
      // ignore
    }
  }
}
