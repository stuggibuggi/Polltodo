import type { Questionnaire, Answers, Question } from '../types/questionnaire'
import { decodeCustomOptionValue } from './custom-options'

export interface ApiUser {
  id: string
  email: string
  displayName?: string | null
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  externalId?: string | null
  imported?: boolean
  lastLoginAt?: string | null
  hasLoggedIn?: boolean
}

export interface SelectableUserOption {
  id: string
  email: string
  displayName?: string | null
  externalId?: string | null
}

export interface ApiGroup {
  id: string
  name: string
  description?: string
  memberCount?: number
  questionnaireCount?: number
}

export interface GroupQuestionnaireAssignment {
  id: string
  title: string
  status: 'DRAFT' | 'PUBLISHED'
  activeFrom?: string | null
  activeTo?: string | null
  assignment?: {
    frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
    intervalDays?: number | null
    activeFrom?: string | null
    activeTo?: string | null
  }
}

export interface SubmissionRecord {
  id: string
  questionnaireId: string
  questionnaire?: {
    id: string
    title: string
    subtitle?: string | null
    version: number
    globalForAllUsers?: boolean
    showJiraTicketLinkInHistory?: boolean
    showReadonlyResultLinkInHistory?: boolean
    allowReadonlyResultLinkForAllUsers?: boolean
    homeTileDescriptionHtml?: string | null
    homeTileColor?: string | null
    homeTileAttributes?: string[] | null
  } | null
  questionnaireVersion?: number
  questionnaireSnapshot?: {
    id: string
    title: string
    subtitle?: string | null
    version: number
    sections: Questionnaire['sections']
  } | null
  answers: Answers
  displayAnswers?: Record<string, string>
  user?: { id: string; email: string; externalId?: string | null } | null
  objectTask?: {
    id: string
    object?: {
      id: string
      externalId?: string | null
      name: string
      type?: string | null
      metadata?: Record<string, unknown> | null
    } | null
  } | null
  submittedAt: string
  submissionNote?: string | null
  jiraIssue?: {
    submissionId: string
    issueKey: string
    issueId?: string | null
    browseUrl?: string | null
    createdAt: string
  } | null
}

export interface UserAssignmentOverview {
  roleAssignments: Array<{
    id: string
    objectId: string
    objectName: string
    roleName: string
    via: 'DIRECT' | 'GROUP'
    groupName?: string | null
  }>
  surveyAssignments: Array<{
    id: string
    source: 'OBJECT' | 'OBJECT_GROUP' | 'OBJECT_OVERRIDE' | 'USER_GROUP'
    objectId?: string | null
    objectName?: string | null
    surveyName: string
    questionnaireId: string
    questionnaireTitle: string
    questionnaireStatus: 'DRAFT' | 'PUBLISHED'
    performedCount: number
    openCount: number
    activeFrom?: string | null
    activeTo?: string | null
    roleNames: string[]
  }>
}

export interface JiraMeta {
  enabled: boolean
  issueCreateUrl: string
  issueBrowseUrl: string
  userSearchUrl: string
  defaultProjectKey: string
  defaultIssueType: string
  contactCustomFieldId?: string
  epicNameCustomFieldId?: string
  defaultComponents?: string[]
}

export interface QuestionnaireJiraConfig {
  questionnaireId: string
  autoCreateOnSubmission: boolean
  attachExcelToIssue?: boolean
  attachPdfToIssue?: boolean
  includeSurveyTextInDescription?: boolean
  includeReadonlyLinkInDescription?: boolean
  descriptionIntroHtml?: string | null
  projectKey?: string | null
  issueType?: string | null
  summaryTemplate?: string | null
  summaryQuestionId?: string | null
  summaryPrefix?: string | null
  summarySuffix?: string | null
  includeObjectInSummary?: boolean
  includeObjectAsComponent?: boolean
  assignee?: string | null
  contactPerson?: string | null
  contactPersonMode?: 'STATIC' | 'SUBMITTER_USER_ID'
  epicName?: string | null
  components: string[]
  dueDate?: string | null
}

export interface QuestionnaireJiraConfigListItem extends QuestionnaireJiraConfig {
  questionnaireTitle: string
  questionnaireDeletedAt?: string | null
  updatedAt: string
}

export interface JiraConnectivityDebugResult {
  ok: boolean
  checks: Array<{
    label: string
    url: string
    ok: boolean
    status: number | null
    statusText: string | null
    timingMs: number
    responseHeaders?: Record<string, string | null>
    bodySnippet?: string
    error?: unknown
  }>
  summary: {
    total: number
    succeeded: number
    failed: number
  }
  config: {
    hasCreateConfig: boolean
    hasUserSearchConfig: boolean
    issueCreateUrl: string | null
    issueBrowseUrl: string | null
    userSearchUrl: string | null
    jiraApiBase: string | null
    jiraAuthUser: string | null
  }
}

export interface QuestionTypeCatalogItem {
  key: string
  label: string
  answerTypeLabel: string
  enabled: boolean
  usage: {
    questionnaireCount: number
    questionCount: number
  }
}

export interface ObjectPickerFilterOptions {
  types: string[]
  metadataKeys: string[]
  metadataValues?: string[]
  objectGroups: Array<{ id: string; name: string }>
}

export interface HomePageConfig {
  title: string
  subtitle: string
  descriptionHtml: string
  faviconDataUrl: string
  welcomeContentHtml: string
  headingOpenTasks: string
  headingGlobalCatalogs: string
  headingClosedTasks: string
  tileOpenTitle: string
  tileOpenDescription: string
  tileOpenBackgroundColor: string
  tileOpenBackgroundColorDark: string
  tileGlobalTitle: string
  tileGlobalDescription: string
  tileGlobalBackgroundColor: string
  tileGlobalBackgroundColorDark: string
  tileHistoryTitle: string
  tileHistoryDescription: string
  tileHistoryBackgroundColor: string
  tileHistoryBackgroundColorDark: string
  showOpenTasks: boolean
  showGlobalCatalogs: boolean
  showClosedTasks: boolean
  openTasksGrouping: 'object' | 'object_group'
  defaultRouteAfterLogin: string
}

export interface LoginPageConfig {
  title: string
  subtitle: string
  hintText: string
  usernameLabel: string
  usernamePlaceholder: string
  passwordLabel: string
  passwordPlaceholder: string
  submitButtonLabel: string
  logoDataUrl: string
  logoWidthPx: number
  logoPlacement: 'top' | 'left' | 'right' | 'center' | 'header'
}

export interface ExternalObjectImportDefinition {
  id: string
  name: string
  description?: string | null
  importMode?: 'OBJECTS' | 'PEOPLE_ROLES_OBJECT' | 'USERS_LDAP'
  sqlQuery: string
  sqlHost: string
  sqlPort: number
  sqlDatabase: string
  sqlUsername: string
  sqlPasswordMasked?: string
  sqlEncrypt: boolean
  sqlTrustServerCertificate: boolean
  mapObjectIdColumn?: string
  mapTypeColumn?: string
  mapNameColumn?: string
  mapDescriptionColumn?: string
  mapMetadataColumn?: string
  mapUserIdColumn?: string
  mapUserEmailColumn?: string
  mapUserDisplayNameColumn?: string
  mapRoleNameColumn?: string
  scheduleEveryMinutes?: number | null
  enabled: boolean
  deleteMissing: boolean
  adminGroupIds?: string[]
  lastRunAt?: string | null
  lastRunStatus?: string | null
  lastRunMessage?: string | null
  lastRunSummary?: Record<string, unknown> | null
  createdAt?: string
  updatedAt?: string
}

export interface ExternalObjectImportRun {
  id: string
  definitionId: string
  startedAt: string
  finishedAt?: string | null
  status: string
  dryRun: boolean
  sourceRows?: number | null
  importedRows?: number | null
  createdCount?: number | null
  updatedCount?: number | null
  deletedCount?: number | null
  skippedCount?: number | null
  warningCount?: number | null
  message?: string | null
  warnings?: unknown
  summary?: unknown
}

export interface ObjectSurveyTask {
  id: string
  policyId: string
  objectId: string
  questionnaireId: string
  submissionId?: string | null
  dueAt: string
  status: 'OPEN' | 'DONE' | 'CLOSED_BY_OTHER'
  startedAt?: string
  startedByUserId?: string
  startedBy?: { id: string; email: string }
  completedAt?: string
  completedByUserId?: string
  questionnaire?: Questionnaire
  object?: {
    id: string
    externalId?: string | null
    name: string
    type?: string | null
    metadata?: Record<string, unknown> | null
    groupMemberships?: Array<{ group: { id: string; name: string } }>
  }
  completedBy?: { id: string; email: string }
  submissionNote?: string | null
  submissionSubmittedAt?: string | null
  policy?: { id: string; createdByGroupId?: string | null; createdByObjectGroupId?: string | null }
  jiraIssue?: {
    submissionId: string
    issueKey: string
    issueId?: string | null
    browseUrl?: string | null
    createdAt: string
  } | null
}

export interface QuestionnaireKpiOverviewRow {
  questionnaireId: string
  questionnaireTitle: string
  objectId: string
  objectName: string
  objectExternalId?: string | null
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'NO_TASK'
  directPath: string
  eligibleUsers: Array<{ id: string; displayName?: string | null; email: string }>
  currentEditor?: { id: string; displayName?: string | null; email: string } | null
}

export interface QuestionnaireKpiOverviewResponse {
  questionnaireId: string
  questionnaireTitle: string
  rows: QuestionnaireKpiOverviewRow[]
}

export interface ObjectQuestionnairePrefill {
  exists: boolean
  source?: 'MANUAL_IMPORT' | 'LAST_SUBMISSION'
  id?: string
  objectId?: string
  questionnaireId?: string
  questionnaireVersion?: number | null
  versionMatches?: boolean
  answers?: Answers
  createdAt?: string
  updatedAt?: string
}

class ApiError extends Error {
  status: number
  data?: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

const API_BASE = '/api'

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let data: unknown
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      data = await res.json()
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : res.statusText
      throw new ApiError(message || res.statusText, res.status, data)
    }
    const text = await res.text()
    throw new ApiError(text || res.statusText, res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  async login(email: string, password: string): Promise<ApiUser> {
    return fetchJson<ApiUser>(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },
  async logout(): Promise<void> {
    await fetchJson(`${API_BASE}/auth/logout`, { method: 'POST' })
  },
  async me(): Promise<ApiUser> {
    return fetchJson<ApiUser>(`${API_BASE}/auth/me`)
  },
  async listUsers(): Promise<ApiUser[]> {
    return fetchJson<ApiUser[]>(`${API_BASE}/users`)
  },
  async listUserSubmissions(userId: string): Promise<SubmissionRecord[]> {
    return fetchJson<SubmissionRecord[]>(`${API_BASE}/users/${userId}/submissions`)
  },
  async resetUserQuestionnaire(userId: string, questionnaireId: string): Promise<void> {
    await fetchJson(`${API_BASE}/users/${userId}/reset`, {
      method: 'POST',
      body: JSON.stringify({ questionnaireId }),
    })
  },
  async createUser(input: { email: string; password: string; role: ApiUser['role']; displayName?: string }): Promise<ApiUser> {
    return fetchJson<ApiUser>(`${API_BASE}/users`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateUser(id: string, input: { email?: string; password?: string; role?: ApiUser['role']; displayName?: string }): Promise<ApiUser> {
    return fetchJson<ApiUser>(`${API_BASE}/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteUser(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/users/${id}`, { method: 'DELETE' })
  },
  async deleteUsersByEmailFilter(emailContains: string, excludeAdmins = true): Promise<{ ok: boolean; count: number }> {
    return fetchJson(`${API_BASE}/users/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ emailContains, excludeAdmins }),
    })
  },
  async previewDeleteUsersByEmailFilter(emailContains: string, excludeAdmins = true): Promise<{ ok: boolean; count: number }> {
    return fetchJson(`${API_BASE}/users/bulk-delete/preview`, {
      method: 'POST',
      body: JSON.stringify({ emailContains, excludeAdmins }),
    })
  },
  async listGroups(): Promise<ApiGroup[]> {
    return fetchJson<ApiGroup[]>(`${API_BASE}/groups`)
  },
  async listObjects(): Promise<Array<{ id: string; externalId?: string | null; name: string; type?: string; description?: string | null }>> {
    return fetchJson(`${API_BASE}/objects`)
  },
  async listObjectsWithGroups(params?: {
    type?: string
    meta?: string
    metaKey?: string
    metaValue?: string
    q?: string
  }): Promise<
    Array<{
      id: string
      externalId?: string | null
      name: string
      type?: string
      description?: string | null
      metadata?: unknown
      groups: Array<{ id: string; name: string }>
      roleSummary?: Array<{ roleName: string; personCount: number }>
      surveyAssignments?: Array<{
        id: string
        source: 'DIRECT' | 'OBJECT_GROUP'
        surveyName: string
        questionnaireId: string
        questionnaireTitle: string
        questionnaireStatus: 'DRAFT' | 'PUBLISHED'
        performedCount: number
        openCount: number
        activeFrom?: string | null
        activeTo?: string | null
        assignees: string[]
      }>
    }>
  > {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    if (params?.meta) query.set('meta', params.meta)
    if (params?.metaKey) query.set('metaKey', params.metaKey)
    if (params?.metaValue) query.set('metaValue', params.metaValue)
    if (params?.q) query.set('q', params.q)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson(`${API_BASE}/objects/with-groups${suffix}`)
  },
  async getUserAssignmentOverview(userId: string): Promise<UserAssignmentOverview> {
    return fetchJson(`${API_BASE}/users/${userId}/assignment-overview`)
  },
  async createObject(input: { name: string; type?: string; metadata?: unknown; externalId?: string; description?: string }): Promise<void> {
    await fetchJson(`${API_BASE}/objects`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async deleteObject(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/objects/${id}`, { method: 'DELETE' })
  },
  async updateObject(id: string, input: { name?: string; type?: string; metadata?: unknown; externalId?: string; description?: string }): Promise<void> {
    await fetchJson(`${API_BASE}/objects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteObjectsByType(type: string): Promise<{ ok: boolean; count: number }> {
    return fetchJson(`${API_BASE}/objects/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    })
  },
  async getObjectSummary(objectId: string): Promise<{
    total: number
    open: number
    done: number
    closedByOther: number
    lastCompletedAt?: string | null
    nextDueAt?: string | null
  }> {
    return fetchJson(`${API_BASE}/objects/${objectId}/summary`)
  },
  async listObjectTasks(objectId: string): Promise<ObjectSurveyTask[]> {
    return fetchJson(`${API_BASE}/objects/${objectId}/tasks`)
  },
  async listRoles(): Promise<Array<{ id: string; name: string; assignedUserCount?: number }>> {
    return fetchJson(`${API_BASE}/roles`)
  },
  async listQuestionTypeCatalog(): Promise<QuestionTypeCatalogItem[]> {
    return fetchJson(`${API_BASE}/admin/question-types`)
  },
  async updateQuestionTypeCatalog(
    items: Array<{ key: string; enabled: boolean }>
  ): Promise<void> {
    await fetchJson(`${API_BASE}/admin/question-types`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    })
  },
  async searchObjectPickerOptions(params: {
    q?: string
    page?: number
    pageSize?: number
    types?: string[]
    ids?: string[]
    type?: string
    metadataKey?: string
    metadataValue?: string
    objectGroupIds?: string[]
    questionnaireId?: string
    taskId?: string
  }): Promise<{ items: Array<{ id: string; name: string; externalId?: string | null; type?: string | null }>; total: number; page: number; pageSize: number }> {
    const query = new URLSearchParams()
    if (params.q) query.set('q', params.q)
    if (params.page) query.set('page', String(params.page))
    if (params.pageSize) query.set('pageSize', String(params.pageSize))
    if (params.types?.length) query.set('types', params.types.join(','))
    if (params.ids?.length) query.set('ids', params.ids.join(','))
    if (params.type) query.set('type', params.type)
    if (params.metadataKey) query.set('metadataKey', params.metadataKey)
    if (params.metadataValue) query.set('metadataValue', params.metadataValue)
    if (params.objectGroupIds?.length) query.set('objectGroupIds', params.objectGroupIds.join(','))
    if (params.questionnaireId) query.set('questionnaireId', params.questionnaireId)
    if (params.taskId) query.set('taskId', params.taskId)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson(`${API_BASE}/me/object-picker-options${suffix}`)
  },
  async getObjectPickerFilterOptions(metaKey?: string): Promise<ObjectPickerFilterOptions> {
    const query = new URLSearchParams()
    if (metaKey?.trim()) query.set('metaKey', metaKey.trim())
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson(`${API_BASE}/admin/object-picker/filter-options${suffix}`)
  },
  async getMyHomeConfig(): Promise<HomePageConfig> {
    return fetchJson(`${API_BASE}/me/home-config`)
  },
  async getAdminHomeConfig(): Promise<HomePageConfig> {
    return fetchJson(`${API_BASE}/admin/home-config`)
  },
  async getPublicHomeConfig(): Promise<HomePageConfig> {
    return fetchJson(`${API_BASE}/public/home-config`)
  },
  async updateAdminHomeConfig(input: Partial<HomePageConfig>): Promise<HomePageConfig> {
    return fetchJson(`${API_BASE}/admin/home-config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async getPublicLoginConfig(): Promise<LoginPageConfig> {
    return fetchJson(`${API_BASE}/public/login-config`)
  },
  async getAdminLoginConfig(): Promise<LoginPageConfig> {
    return fetchJson(`${API_BASE}/admin/login-config`)
  },
  async updateAdminLoginConfig(input: Partial<LoginPageConfig>): Promise<LoginPageConfig> {
    return fetchJson(`${API_BASE}/admin/login-config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async listObjectGroupsForObject(objectId: string): Promise<Array<{ id: string; name: string }>> {
    return fetchJson(`${API_BASE}/objects/${objectId}/groups`)
  },
  async getObjectPrefill(objectId: string, questionnaireId: string): Promise<ObjectQuestionnairePrefill> {
    return fetchJson(`${API_BASE}/objects/${objectId}/prefills/${questionnaireId}`)
  },
  async upsertObjectPrefill(
    objectId: string,
    questionnaireId: string,
    input: { questionnaireVersion?: number; answers: Answers }
  ): Promise<{ ok: boolean; answerCount: number }> {
    return fetchJson(`${API_BASE}/objects/${objectId}/prefills/${questionnaireId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async importObjectPrefillsBulk(payload: {
    rows: Array<Record<string, unknown>>
    defaultQuestionnaireVersion?: number | null
  }): Promise<{
    ok: boolean
    processedRows: number
    importedPairs: number
    skippedRows: number
    errors: string[]
  }> {
    return fetchJson(`${API_BASE}/prefills/bulk`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  async createRole(name: string): Promise<void> {
    await fetchJson(`${API_BASE}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  async deleteRole(roleId: string): Promise<void> {
    await fetchJson(`${API_BASE}/roles/${roleId}`, { method: 'DELETE' })
  },
  async listObjectAssignments(objectId: string): Promise<Array<{ roleId: string; userId?: string; groupId?: string }>> {
    return fetchJson(`${API_BASE}/objects/${objectId}/assignments`)
  },
  async setObjectAssignments(
    objectId: string,
    assignments: Array<{ roleId: string; userId?: string; groupId?: string }>
  ): Promise<void> {
    await fetchJson(`${API_BASE}/objects/${objectId}/assignments`, {
      method: 'PUT',
      body: JSON.stringify({ assignments }),
    })
  },
  async listObjectPolicies(objectId: string): Promise<unknown[]> {
    return fetchJson(`${API_BASE}/objects/${objectId}/policies`)
  },
  async listObjectOverrides(objectId: string): Promise<unknown[]> {
    return fetchJson(`${API_BASE}/objects/${objectId}/overrides`)
  },
  async createObjectPolicy(
    objectId: string,
    input: {
      questionnaireId: string
      frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      intervalDays?: number
      roleIds: string[]
      activeFrom?: string
      activeTo?: string
      allowLastSubmissionPrefill?: boolean
    }
  ): Promise<void> {
    await fetchJson(`${API_BASE}/objects/${objectId}/policies`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateObjectPolicy(
    id: string,
    input: {
      frequency?: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      intervalDays?: number
      roleIds?: string[]
      activeFrom?: string
      activeTo?: string
      allowLastSubmissionPrefill?: boolean
    }
  ): Promise<void> {
    await fetchJson(`${API_BASE}/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteObjectPolicy(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/policies/${id}`, { method: 'DELETE' })
  },
  async createObjectOverride(
    objectId: string,
    input: {
      questionnaireId: string
      frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      intervalDays?: number
      roleIds: string[]
      activeFrom?: string
      activeTo?: string
    }
  ): Promise<void> {
    await fetchJson(`${API_BASE}/objects/${objectId}/overrides`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async deleteObjectOverride(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-overrides/${id}`, { method: 'DELETE' })
  },
  async listObjectGroups(): Promise<Array<{ id: string; name: string }>> {
    return fetchJson(`${API_BASE}/object-groups`)
  },
  async listObjectGroupsSummary(params?: { page?: number; pageSize?: number }): Promise<{
    items: Array<{
      id: string
      name: string
      objectCount: number
      surveyCount: number
    }>
    total: number
    page: number
    pageSize: number
  }> {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.pageSize) query.set('pageSize', String(params.pageSize))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson(`${API_BASE}/object-groups/summary${suffix}`)
  },
  async createObjectGroup(name: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-groups`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  async deleteObjectGroup(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-groups/${id}`, { method: 'DELETE' })
  },
  async listObjectGroupMembers(groupId: string): Promise<Array<{ objectId: string }>> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/members`)
  },
  async listObjectGroupRules(groupId: string): Promise<Array<{ id: string; field: string; operator: string; value: string }>> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/rules`)
  },
  async getObjectGroupRuleConfig(groupId: string): Promise<{
    matchMode: 'AND' | 'OR'
    autoSyncEnabled: boolean
    autoSyncIntervalMinutes: number
    lastAutoSyncAt: string | null
    lastAutoSyncStatus: string | null
    lastAutoSyncMessage: string | null
  }> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/rule-config`)
  },
  async updateObjectGroupRuleConfig(
    groupId: string,
    input: {
      matchMode?: 'AND' | 'OR'
      autoSyncEnabled?: boolean
      autoSyncIntervalMinutes?: number
    }
  ): Promise<{
    ok: boolean
    matchMode: 'AND' | 'OR'
    autoSyncEnabled: boolean
    autoSyncIntervalMinutes: number
    lastAutoSyncAt: string | null
    lastAutoSyncStatus: string | null
    lastAutoSyncMessage: string | null
  }> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/rule-config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async createObjectGroupRule(groupId: string, rule: { field: string; operator: string; value: string }): Promise<void> {
    await fetchJson(`${API_BASE}/object-groups/${groupId}/rules`, {
      method: 'POST',
      body: JSON.stringify(rule),
    })
  },
  async deleteObjectGroupRule(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-group-rules/${id}`, { method: 'DELETE' })
  },
  async applyObjectGroupRules(groupId: string): Promise<{ ok: boolean; count: number }> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/apply-rules`, { method: 'POST' })
  },
  async setObjectGroupMembers(groupId: string, objectIds: string[]): Promise<void> {
    await fetchJson(`${API_BASE}/object-groups/${groupId}/members`, {
      method: 'PUT',
      body: JSON.stringify({ objectIds }),
    })
  },
  async listObjectGroupPolicies(groupId: string): Promise<unknown[]> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/policies`)
  },
  async getObjectGroupSummary(groupId: string): Promise<{
    total: number
    open: number
    done: number
    closedByOther: number
    lastCompletedAt?: string | null
    nextDueAt?: string | null
    surveyAssignments?: Array<{
      id: string
      questionnaireId: string
      questionnaireTitle: string
      questionnaireStatus: 'DRAFT' | 'PUBLISHED'
      objectCount: number
      openCount: number
      doneCount: number
      dueAt?: string | null
    }>
  }> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/summary`)
  },
  async listObjectGroupTasks(groupId: string): Promise<Array<{
    id: string
    policyId: string
    objectId: string
    status: string
    dueAt: string
    completedAt?: string | null
    questionnaire?: { title: string } | null
    completedBy?: { email: string } | null
    object?: { name: string } | null
  }>> {
    return fetchJson(`${API_BASE}/object-groups/${groupId}/tasks`)
  },
  async createObjectGroupPolicy(
    groupId: string,
    input: {
      questionnaireId: string
      frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      intervalDays?: number
      roleNames: string[]
      activeFrom?: string
      activeTo?: string
      allowLastSubmissionPrefill?: boolean
    }
  ): Promise<void> {
    await fetchJson(`${API_BASE}/object-groups/${groupId}/policies`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateObjectGroupPolicy(
    id: string,
    input: {
      frequency?: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      intervalDays?: number
      roleNames?: string[]
      activeFrom?: string
      activeTo?: string
      allowLastSubmissionPrefill?: boolean
    }
  ): Promise<void> {
    await fetchJson(`${API_BASE}/object-group-policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteObjectGroupPolicy(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-group-policies/${id}`, { method: 'DELETE' })
  },
  async getGroup(id: string): Promise<ApiGroup> {
    return fetchJson<ApiGroup>(`${API_BASE}/groups/${id}`)
  },
  async createGroup(input: { name: string; description?: string }): Promise<ApiGroup> {
    return fetchJson<ApiGroup>(`${API_BASE}/groups`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateGroup(id: string, input: { name?: string; description?: string }): Promise<ApiGroup> {
    return fetchJson<ApiGroup>(`${API_BASE}/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteGroup(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/groups/${id}`, { method: 'DELETE' })
  },
  async groupMembers(id: string): Promise<ApiUser[]> {
    return fetchJson<ApiUser[]>(`${API_BASE}/groups/${id}/members`)
  },
  async setGroupMembers(
    id: string,
    userIds: string[],
    memberIdentifiers?: string[]
  ): Promise<void> {
    await fetchJson(`${API_BASE}/groups/${id}/members`, {
      method: 'PUT',
      body: JSON.stringify({ userIds, memberIdentifiers }),
    })
  },
  async groupQuestionnaires(id: string): Promise<GroupQuestionnaireAssignment[]> {
    return fetchJson<GroupQuestionnaireAssignment[]>(`${API_BASE}/groups/${id}/questionnaires`)
  },
  async groupObjectGroups(id: string): Promise<Array<{ id: string; name: string }>> {
    return fetchJson<Array<{ id: string; name: string }>>(`${API_BASE}/groups/${id}/object-groups`)
  },
  async setGroupQuestionnaires(
    id: string,
    questionnaireIds:
      | string[]
      | Array<{
          questionnaireId: string
          frequency?: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
          intervalDays?: number
          activeFrom?: string
          activeTo?: string
        }>
  ): Promise<void> {
    await fetchJson(`${API_BASE}/groups/${id}/questionnaires`, {
      method: 'PUT',
      body: Array.isArray(questionnaireIds) && typeof questionnaireIds[0] === 'string'
        ? JSON.stringify({ questionnaireIds })
        : JSON.stringify({ assignments: questionnaireIds }),
    })
  },
  async setGroupObjectGroups(id: string, objectGroupIds: string[]): Promise<void> {
    await fetchJson(`${API_BASE}/groups/${id}/object-groups`, {
      method: 'PUT',
      body: JSON.stringify({ objectGroupIds }),
    })
  },
  async listQuestionnaires(options?: { includeDeleted?: boolean; withStats?: boolean }): Promise<Questionnaire[]> {
    const query = new URLSearchParams()
    if (options?.includeDeleted) query.set('includeDeleted', '1')
    if (options?.withStats) query.set('withStats', '1')
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson<Questionnaire[]>(`${API_BASE}/questionnaires${suffix}`)
  },
  async getQuestionnaire(id: string): Promise<Questionnaire> {
    return fetchJson<Questionnaire>(`${API_BASE}/questionnaires/${id}`)
  },
  async acquireQuestionnaireEditorLock(id: string): Promise<{
    ok: boolean
    userId: string
    userEmail?: string | null
    lockedAt: string
    expiresAt: string
    ttlSeconds: number
  }> {
    return fetchJson(`${API_BASE}/questionnaires/${id}/editor-lock`, {
      method: 'POST',
    })
  },
  async releaseQuestionnaireEditorLock(id: string): Promise<{ ok: boolean; released: boolean }> {
    return fetchJson(`${API_BASE}/questionnaires/${id}/editor-lock/release`, {
      method: 'POST',
    })
  },
  async createQuestionnaire(input: Questionnaire): Promise<Questionnaire> {
    return fetchJson<Questionnaire>(`${API_BASE}/questionnaires`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateQuestionnaire(id: string, input: Partial<Questionnaire>): Promise<Questionnaire> {
    return fetchJson<Questionnaire>(`${API_BASE}/questionnaires/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteQuestionnaire(id: string, options?: { deleteResults?: boolean }): Promise<void> {
    await fetchJson(`${API_BASE}/questionnaires/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleteResults: options?.deleteResults !== false }),
    })
  },
  async listMyQuestionnaires(status: 'current' | 'all' = 'current'): Promise<Questionnaire[]> {
    return fetchJson<Questionnaire[]>(`${API_BASE}/me/questionnaires?status=${status}`)
  },
  async listMySubmissions(): Promise<SubmissionRecord[]> {
    return fetchJson<SubmissionRecord[]>(`${API_BASE}/me/submissions`)
  },
  async updateMySubmissionNote(
    submissionId: string,
    submissionNote?: string
  ): Promise<{ ok: boolean; submissionId: string; submissionNote?: string | null; submittedAt: string }> {
    return fetchJson(`${API_BASE}/me/submissions/${submissionId}/note`, {
      method: 'PUT',
      body: JSON.stringify({ submissionNote }),
    })
  },
  async getMySubmissionReadonlyData(submissionId: string): Promise<{
    submission: SubmissionRecord
    questionnaire: Questionnaire
  }> {
    return fetchJson(`${API_BASE}/me/submissions/${submissionId}/readonly-data`)
  },
  async listMyObjectTasks(): Promise<ObjectSurveyTask[]> {
    return fetchJson<ObjectSurveyTask[]>(`${API_BASE}/me/object-tasks`)
  },
  async getObjectTask(id: string): Promise<ObjectSurveyTask> {
    return fetchJson<ObjectSurveyTask>(`${API_BASE}/object-tasks/${id}`)
  },
  async getObjectTaskPrefill(id: string): Promise<ObjectQuestionnairePrefill> {
    return fetchJson<ObjectQuestionnairePrefill>(`${API_BASE}/object-tasks/${id}/prefill`)
  },
  async searchSelectableUsers(params: {
    q?: string
    page?: number
    pageSize?: number
  }): Promise<{ items: SelectableUserOption[]; total: number; page: number; pageSize: number }> {
    const query = new URLSearchParams()
    if (params.q?.trim()) query.set('q', params.q.trim())
    if (params.page && params.page > 0) query.set('page', String(params.page))
    if (params.pageSize && params.pageSize > 0) query.set('pageSize', String(params.pageSize))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return fetchJson(`${API_BASE}/me/user-options${suffix}`)
  },
  async submitObjectTask(
    taskId: string,
    questionnaire: Questionnaire,
    answers: Answers,
    submissionNote?: string
  ): Promise<{ ok: boolean; submissionId: string; jiraIssue?: SubmissionRecord['jiraIssue'] }> {
    const displayAnswers: Record<string, string> = {}
    questionnaire.sections.forEach((section) => {
      section.questions.forEach((question) => {
        displayAnswers[question.id] = formatAnswer(question, answers[question.id])
      })
    })
    return fetchJson(`${API_BASE}/object-tasks/${taskId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, displayAnswers, submissionNote }),
    })
  },
  async cancelObjectTask(taskId: string): Promise<{ ok: boolean; released: boolean }> {
    return fetchJson(`${API_BASE}/object-tasks/${taskId}/cancel`, {
      method: 'POST',
    })
  },
  async listSubmissions(questionnaireId: string): Promise<SubmissionRecord[]> {
    return fetchJson<SubmissionRecord[]>(`${API_BASE}/questionnaires/${questionnaireId}/submissions`)
  },
  async getQuestionnaireKpiOverview(questionnaireId: string): Promise<QuestionnaireKpiOverviewResponse> {
    return fetchJson(`${API_BASE}/admin/questionnaires/${questionnaireId}/kpi-overview`)
  },
  async deleteSubmission(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/submissions/${id}`, { method: 'DELETE' })
  },
  async jiraMeta(): Promise<JiraMeta> {
    return fetchJson<JiraMeta>(`${API_BASE}/integrations/jira/meta`)
  },
  async jiraSearchUsers(query: string): Promise<Array<{ username: string; displayName: string; emailAddress: string }>> {
    const q = encodeURIComponent(query.trim())
    return fetchJson(`${API_BASE}/integrations/jira/users?q=${q}`)
  },
  async jiraCreateIssue(input: {
    submissionId: string
    projectKey?: string
    summary?: string
    assignee?: string
    issueType?: string
    contactPerson?: string
    epicName?: string
    components?: string[]
    dueDate?: string
    attachExcelToIssue?: boolean
    attachPdfToIssue?: boolean
  }): Promise<{
    ok: boolean
    key?: string
    id?: string
    browseUrl?: string | null
    attachments?: Array<{ filename: string; ok: boolean; error?: string }>
  }> {
    return fetchJson(`${API_BASE}/integrations/jira/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async jiraDebugCreateIssue(input: {
    submissionId: string
    projectKey?: string
    summary?: string
    assignee?: string
    issueType?: string
    contactPerson?: string
    epicName?: string
    components?: string[]
    dueDate?: string
    attachExcelToIssue?: boolean
    attachPdfToIssue?: boolean
    dryRun?: boolean
  }): Promise<{
    ok: boolean
    dryRun: boolean
    key?: string
    id?: string | null
    browseUrl?: string | null
    details?: string
    request?: unknown
    diagnostics?: unknown
    response?: unknown
    attachments?: Array<{ filename: string; ok: boolean; error?: string }>
  }> {
    return fetchJson(`${API_BASE}/integrations/jira/debug/create`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async jiraDebugConnectivity(input?: {
    projectKey?: string
    issueNumber?: string
    userQuery?: string
  }): Promise<JiraConnectivityDebugResult> {
    return fetchJson(`${API_BASE}/integrations/jira/debug/connectivity`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    })
  },
  async jiraGetIssue(projectKey: string, issueNumber: string): Promise<{
    ok: boolean
    issueKey: string
    id?: string | null
    key?: string
    summary?: string | null
    status?: string | null
    assignee?: string | null
    reporter?: string | null
    created?: string | null
    updated?: string | null
    browseUrl?: string | null
    raw?: unknown
  }> {
    return fetchJson(
      `${API_BASE}/integrations/jira/issues/${encodeURIComponent(projectKey)}/${encodeURIComponent(issueNumber)}`
    )
  },
  async getQuestionnaireJiraConfig(questionnaireId: string): Promise<QuestionnaireJiraConfig> {
    return fetchJson(`${API_BASE}/admin/questionnaires/${questionnaireId}/jira-config`)
  },
  async updateQuestionnaireJiraConfig(
    questionnaireId: string,
    input: Partial<QuestionnaireJiraConfig>
  ): Promise<QuestionnaireJiraConfig> {
    return fetchJson(`${API_BASE}/admin/questionnaires/${questionnaireId}/jira-config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async listQuestionnaireJiraConfigs(): Promise<QuestionnaireJiraConfigListItem[]> {
    return fetchJson(`${API_BASE}/admin/jira-configs`)
  },
  async maintenanceOverrideCleanup(
    apply: boolean
  ): Promise<{ ok: boolean; stalePolicyCount: number; staleTaskCount: number; mode: 'dry-run' | 'apply' }> {
    return fetchJson(`${API_BASE}/admin/maintenance/override-cleanup`, {
      method: 'POST',
      body: JSON.stringify({ apply }),
    })
  },
  async listExternalObjectImportDefinitions(): Promise<ExternalObjectImportDefinition[]> {
    return fetchJson(`${API_BASE}/object-import-definitions`)
  },
  async getExternalObjectImportDefinition(id: string): Promise<ExternalObjectImportDefinition> {
    return fetchJson(`${API_BASE}/object-import-definitions/${id}`)
  },
  async createExternalObjectImportDefinition(input: {
    name: string
    description?: string
    importMode?: 'OBJECTS' | 'PEOPLE_ROLES_OBJECT' | 'USERS_LDAP'
    sqlQuery: string
    sqlHost: string
    sqlPort?: number
    sqlDatabase: string
    sqlUsername: string
    sqlPassword: string
    sqlEncrypt?: boolean
    sqlTrustServerCertificate?: boolean
    mapObjectIdColumn?: string
    mapTypeColumn?: string
    mapNameColumn?: string
    mapDescriptionColumn?: string
    mapMetadataColumn?: string
    mapUserIdColumn?: string
    mapUserEmailColumn?: string
    mapUserDisplayNameColumn?: string
    mapRoleNameColumn?: string
    scheduleEveryMinutes?: number | null
    enabled?: boolean
    deleteMissing?: boolean
  }): Promise<ExternalObjectImportDefinition> {
    return fetchJson(`${API_BASE}/object-import-definitions`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateExternalObjectImportDefinition(
    id: string,
    input: {
      name?: string
      description?: string
      importMode?: 'OBJECTS' | 'PEOPLE_ROLES_OBJECT' | 'USERS_LDAP'
      sqlQuery?: string
      sqlHost?: string
      sqlPort?: number
      sqlDatabase?: string
      sqlUsername?: string
      sqlPassword?: string
      sqlEncrypt?: boolean
      sqlTrustServerCertificate?: boolean
      mapObjectIdColumn?: string
      mapTypeColumn?: string
      mapNameColumn?: string
      mapDescriptionColumn?: string
      mapMetadataColumn?: string
      mapUserIdColumn?: string
      mapUserEmailColumn?: string
      mapUserDisplayNameColumn?: string
      mapRoleNameColumn?: string
      scheduleEveryMinutes?: number | null
      enabled?: boolean
      deleteMissing?: boolean
    }
  ): Promise<ExternalObjectImportDefinition> {
    return fetchJson(`${API_BASE}/object-import-definitions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },
  async deleteExternalObjectImportDefinition(id: string): Promise<void> {
    await fetchJson(`${API_BASE}/object-import-definitions/${id}`, { method: 'DELETE' })
  },
  async listExternalObjectImportRuns(id: string, limit = 50): Promise<ExternalObjectImportRun[]> {
    return fetchJson(`${API_BASE}/object-import-definitions/${id}/runs?limit=${encodeURIComponent(String(limit))}`)
  },
  async testExternalObjectImportDefinition(id: string): Promise<{
    ok: boolean
    rowCount: number
    normalizedCount: number
    metadataMappedCount?: number
    warnings: string[]
    sample: unknown[]
  }> {
    return fetchJson(`${API_BASE}/object-import-definitions/${id}/test`, {
      method: 'POST',
    })
  },
  async runExternalObjectImportDefinition(
    id: string,
    dryRun = false
  ): Promise<{ ok: boolean; summary: Record<string, unknown>; warnings: string[] }> {
    return fetchJson(`${API_BASE}/object-import-definitions/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    })
  },
  async importBulk(payload: {
    users?: Array<{ email: string; password?: string; role?: 'ADMIN' | 'EDITOR' | 'VIEWER'; external_id?: string; display_name?: string }>
    objects?: Array<{ object_id: string; object_name: string; object_type?: string; meta_json?: unknown }>
    roles?: Array<{ role_name: string }>
    assignments?: Array<{
      object_id: string
      role_name: string
      user_email?: string
      user_id?: string
      group_name?: string
    }>
    policies?: Array<{
      object_id: string
      questionnaire_title: string
      frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      interval_days?: number
      role_names: string
      active_from?: string
      active_to?: string
    }>
    object_groups?: Array<{ group_name: string }>
    group_memberships?: Array<{ group_name: string; object_id: string }>
    group_policies?: Array<{
      group_name: string
      questionnaire_title: string
      frequency: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM_DAYS'
      interval_days?: number
      role_names: string
      active_from?: string
      active_to?: string
    }>
  }): Promise<{ ok: boolean; errors: string[]; summary?: Record<string, number> }> {
    return fetchJson(`${API_BASE}/import/bulk`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  async saveSubmission(
    questionnaire: Questionnaire,
    answers: Answers,
    submissionNote?: string
  ): Promise<SubmissionRecord> {
    const displayAnswers: Record<string, string> = {}
    questionnaire.sections.forEach((section) => {
      section.questions.forEach((question) => {
        displayAnswers[question.id] = formatAnswer(question, answers[question.id])
      })
    })
    return fetchJson(`${API_BASE}/questionnaires/${questionnaire.id}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ answers, displayAnswers, submissionNote }),
    })
  },
}

function formatAnswer(question: Question, value: unknown): string {
  const normalize = (val: unknown): string => {
    if (val === undefined || val === null || val === '') return '-'
    if (typeof val === 'object') {
      const obj = val as { label?: string; value?: string }
      if (obj.label) return obj.label
      if (obj.value) return obj.value
    }
    return String(val)
  }

  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'object' && v !== null) {
          const obj = v as { label?: string; value?: string }
          if (obj.label && obj.value) return `${obj.label} (${obj.value})`
          if (obj.label) return obj.label
          if (obj.value) return obj.value
        }
        const opt = question.options?.find((o) => o.value === v)
        if (opt?.label) return `${opt.label} (${opt.value})`
        const custom = decodeCustomOptionValue(v)
        if (custom) return `${custom} (added)`
        const byLabel = question.options?.find((o) => o.label === String(v))
        return byLabel?.label ? `${byLabel.label} (${byLabel.value})` : normalize(v)
      })
      .join(', ')
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (question.type === 'assignment_picker') {
    if (typeof value !== 'string' || !value.trim()) return '-'
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '-'
      const optionMap = new Map((question.assignmentOptions ?? []).map((opt) => [opt.id, opt]))
      const lines: string[] = []
      Object.entries(parsed).forEach(([optionId, rawEntry]) => {
        const option = optionMap.get(optionId)
        const label = option?.label || optionId
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return
        const valuesRaw = (rawEntry as { values?: unknown }).values
        const values = Array.isArray(valuesRaw)
          ? valuesRaw.map((entry) => String(entry ?? '').trim()).filter(Boolean)
          : []
        const rendered = values.length > 0 ? values.join(', ') : '-'
        lines.push(`${label}: ${rendered}`)
      })
      return lines.length > 0 ? lines.join(' | ') : '-'
    } catch {
      return '-'
    }
  }
  if (question.type === 'single' && question.options?.length) {
    const opt = question.options.find((o) => o.value === value)
    if (opt?.label) return `${opt.label} (${opt.value})`
    const custom = decodeCustomOptionValue(value)
    if (custom) return `${custom} (added)`
    const byLabel = question.options.find((o) => o.label === String(value))
    if (byLabel?.label) return `${byLabel.label} (${byLabel.value})`
  }
  return normalize(value)
}

export { ApiError }
