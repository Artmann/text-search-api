import { ApiError } from '../errors'

export const embedModelName = '@cf/baai/bge-base-en-v1.5'

export const maxTitleLength = 100
export const maxContentLength = 5_000

const idSeparator = ':'

export interface DocumentInput {
  content: string
  key: string
  metadata?: Record<string, string | number | boolean>
  namespace: string
  title: string
}

export interface DecodedDocument {
  content: string
  key: string
  metadata: Record<string, unknown>
  namespace: string
  title: string
}

export interface StoredVectorLike {
  id: string
  metadata?: Record<string, unknown> | null
}

export function validateKey(key: string): void {
  if (key.includes(idSeparator)) {
    throw new ApiError(
      400,
      'invalid_body',
      `key: must not contain "${idSeparator}".`
    )
  }
}

export function formatId(namespace: string, key: string): string {
  return `${namespace}${idSeparator}${key}`
}

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const output = (await ai.run(embedModelName, { text: [text] })) as {
    data: number[][]
  }

  return output.data[0]
}

export async function toStoredVector(
  ai: Ai,
  document: DocumentInput
): Promise<VectorizeVector> {
  validateKey(document.key)

  const truncatedTitle = truncate(document.title, maxTitleLength)
  const truncatedContent = truncate(document.content, maxContentLength)

  const values = await embedText(
    ai,
    `${truncatedTitle}\n\n${truncatedContent}`
  )

  return {
    id: formatId(document.namespace, document.key),
    metadata: {
      ...(document.metadata ?? {}),
      content: truncatedContent,
      title: truncatedTitle
    },
    namespace: document.namespace,
    values
  }
}

export function fromStoredVector(vector: StoredVectorLike): DecodedDocument {
  const { key, namespace } = parseId(vector.id)
  const metadata = (vector.metadata ?? {}) as Record<string, unknown>
  const { content, title, ...rest } = metadata

  return {
    content: content as string,
    key,
    metadata: rest,
    namespace,
    title: title as string
  }
}

function parseId(id: string): { key: string; namespace: string } {
  const separatorIndex = id.indexOf(idSeparator)

  return {
    key: id.slice(separatorIndex + 1),
    namespace: id.slice(0, separatorIndex)
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}
