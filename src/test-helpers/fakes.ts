import invariant from 'tiny-invariant'

const vectorDimensions = 32

export interface FakeAi {
  run: (
    model: string,
    input: { text: string[] }
  ) => Promise<{ data: number[][] }>
  readonly calls: ReadonlyArray<{ model: string; text: string }>
  failNext: (error: Error) => void
}

export interface FakeVectorize {
  deleteByIds: (ids: string[]) => Promise<{ mutationId: string }>
  failNext: (
    method: 'getByIds' | 'upsert' | 'query' | 'deleteByIds',
    error: Error
  ) => void
  getByIds: (ids: string[]) => Promise<Array<FakeVector>>
  query: (
    vector: number[],
    options: {
      filter?: Record<string, unknown>
      namespace?: string
      returnMetadata?: 'all' | 'indexed' | 'none'
      topK?: number
    }
  ) => Promise<{
    matches: Array<{
      id: string
      metadata: Record<string, unknown>
      score: number
    }>
  }>
  readonly store: ReadonlyMap<string, FakeVector>
  upsert: (vectors: FakeVector[]) => Promise<{ mutationId: string }>
}

export interface FakeVector {
  id: string
  metadata: Record<string, unknown>
  namespace?: string
  values: number[]
}

export function createFakeAi(): FakeAi {
  const calls: Array<{ model: string; text: string }> = []
  let pendingError: Error | null = null

  return {
    get calls() {
      return calls
    },
    failNext(error) {
      pendingError = error
    },
    async run(model, input) {
      invariant(
        Array.isArray(input.text) && input.text.length === 1,
        'FakeAi expects { text: [singleString] }'
      )

      const text = input.text[0] ?? ''
      calls.push({ model, text })

      if (pendingError) {
        const error = pendingError
        pendingError = null
        throw error
      }

      return { data: [embedText(text)] }
    }
  }
}

export function createFakeVectorize(): FakeVectorize {
  const store = new Map<string, FakeVector>()
  const pendingErrors = new Map<string, Error>()

  function consumeError(method: string): Error | null {
    const error = pendingErrors.get(method)

    if (error) {
      pendingErrors.delete(method)
      return error
    }

    return null
  }

  return {
    get store() {
      return store
    },

    failNext(method, error) {
      pendingErrors.set(method, error)
    },

    async deleteByIds(ids) {
      const error = consumeError('deleteByIds')
      if (error) {
        throw error
      }

      for (const id of ids) {
        store.delete(id)
      }

      return { mutationId: 'fake-mutation' }
    },

    async getByIds(ids) {
      const error = consumeError('getByIds')
      if (error) {
        throw error
      }

      const results: FakeVector[] = []
      for (const id of ids) {
        const entry = store.get(id)
        if (entry) {
          results.push(entry)
        }
      }

      return results
    },

    async query(vector, options) {
      const error = consumeError('query')
      if (error) {
        throw error
      }

      const topK = options.topK ?? 10
      const namespace = options.namespace
      const filter = options.filter

      const candidates: Array<{
        id: string
        metadata: Record<string, unknown>
        score: number
      }> = []

      for (const entry of store.values()) {
        if (namespace !== undefined && entry.namespace !== namespace) {
          continue
        }

        if (filter && !matchesFilter(entry.metadata, filter)) {
          continue
        }

        candidates.push({
          id: entry.id,
          metadata: entry.metadata,
          score: cosineSimilarity(vector, entry.values)
        })
      }

      candidates.sort((a, b) => b.score - a.score)

      return { matches: candidates.slice(0, topK) }
    },

    async upsert(vectors) {
      const error = consumeError('upsert')
      if (error) {
        throw error
      }

      for (const vector of vectors) {
        store.set(vector.id, {
          id: vector.id,
          metadata: vector.metadata,
          namespace: vector.namespace,
          values: vector.values
        })
      }

      return { mutationId: 'fake-mutation' }
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  invariant(a.length === b.length, 'Vectors must have the same dimension')

  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB)

  if (denominator === 0) {
    return 0
  }

  return dot / denominator
}

function embedText(text: string): number[] {
  const vector = new Array<number>(vectorDimensions).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []

  for (const token of tokens) {
    const bucket = hashString(token) % vectorDimensions
    vector[bucket] += 1
  }

  return vector
}

function hashString(text: string): number {
  let hash = 2166136261

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (metadata[key] !== expected) {
      return false
    }
  }

  return true
}
