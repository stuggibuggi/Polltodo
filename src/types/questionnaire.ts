export type QuestionType =
  | 'info'
  | 'text'
  | 'single'
  | 'multi'
  | 'multiline'
  | 'boolean'
  | 'date_time'
  | 'percentage'
  | 'likert'
  | 'ranking'
  | 'object_picker'
  | 'assignment_picker'

export interface QuestionOption {
  value: string
  label: string
  requiresReason?: boolean
}

export interface AssignmentOption {
  id: string
  label: string
  searchPlaceholder?: string
  required?: boolean
  allowMultiple?: boolean
  targetType: 'object' | 'user'
  objectTypeFilter?: string[]
  objectGroupIds?: string[]
}

/** Bedingung: zeigt diese Frage nur, wenn eine andere Frage einen bestimmten Wert hat */
export interface QuestionDependency {
  questionId: string
  value: string | string[] | boolean
  operator?:
    | 'eq'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'ranking_contains'
    | 'ranking_position_eq'
    | 'ranking_position_better_than'
    | 'object_type_eq'
    | 'object_meta_eq'
    | 'date_is_future'
    | 'date_is_past'
    | 'date_within_future_days'
    | 'date_equals'
  objectMetaKey?: string
  dateValue?: string
  dayOffset?: number
  positionValue?: number
}

export interface Question {
  id: string
  type: QuestionType
  title: string
  description?: string
  descriptionAsPopup?: boolean
  linkUrl?: string
  linkText?: string
  required: boolean
  options?: QuestionOption[]
  dependency?: QuestionDependency
  dependencies?: QuestionDependency[]
  dependencyMode?: 'ALL' | 'ANY'
  placeholder?: string
  allowCustomOptions?: boolean
  dateTimeMode?: 'date' | 'datetime'
  percentageMode?: 'input' | 'slider' | 'select'
  percentageOptions?: number[]
  percentageMinLabel?: string
  percentageMaxLabel?: string
  likertMinLabel?: string
  likertMaxLabel?: string
  likertSteps?: number
  rankingOptions?: Array<{ id: string; label: string }>
  assignmentOptions?: AssignmentOption[]
  objectPickerMode?: 'all' | 'by_type' | 'by_ids'
  objectPickerTypeFilter?: string[]
  objectPickerObjectIds?: string[]
  objectPickerType?: string
  objectPickerMetadataKey?: string
  objectPickerMetadataValue?: string
  objectPickerGroupIds?: string[]
  objectPickerPageSize?: number
  objectPickerAllowMultiple?: boolean
  objectPickerMultiMode?: 'checklist' | 'adder'
  objectPickerPerObjectMetaEnabled?: boolean
  objectPickerPerObjectMetaLabel?: string
  objectPickerPerObjectMetaOptions?: string[]
  objectPickerPerObjectMetaAllowCustomText?: boolean
  objectPickerPerObjectMetaCustomLabel?: string
}

export interface QuestionnaireSection {
  id: string
  title: string
  description?: string
  linkUrl?: string
  linkText?: string
  dependency?: QuestionDependency
  dependencies?: QuestionDependency[]
  dependencyMode?: 'ALL' | 'ANY'
  questions: Question[]
}

export interface Questionnaire {
  id: string
  title: string
  subtitle?: string
  completionPageTitle?: string
  completionPageContent?: string
  sections: QuestionnaireSection[]
  version?: number
  allowMultipleSubmissions?: boolean
  globalForAllUsers?: boolean
  createdByUserId?: string | null
  adminAccessMode?: 'OWNER_ONLY' | 'OWNER_AND_GROUP'
  adminGroupIds?: string[]
  status?: 'DRAFT' | 'PUBLISHED'
  activeFrom?: string | null
  activeTo?: string | null
  deletedAt?: string | null
  createdAt?: string
  updatedAt?: string
  showJiraTicketLinkInHistory?: boolean
  showReadonlyResultLinkInHistory?: boolean
  allowReadonlyResultLinkForAllUsers?: boolean
  homeTileDescriptionHtml?: string
  homeTileColor?: string
  homeTileAttributes?: Array<
    | 'object'
    | 'objectGroup'
    | 'dueDate'
    | 'status'
    | 'version'
    | 'completedAt'
    | 'completedBy'
    | 'globalTag'
  >
  stats?: {
    objectCount: number
    objectGroupCount: number
    personCount: number
    openCount: number
    completedCount: number
    totalTaskCount: number
    assignmentTypes: Array<{ frequency: string; count: number }>
  }
  editorLock?: {
    userId?: string | null
    userEmail?: string | null
    lockedAt?: string | null
    expiresAt?: string | null
  } | null
}

export type Answers = Record<string, string | string[] | boolean | undefined>
