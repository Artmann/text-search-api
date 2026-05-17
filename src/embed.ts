export const embedModelName = '@cf/baai/bge-base-en-v1.5'

export async function embed(ai: Ai, text: string): Promise<number[]> {
  const out = await ai.run(embedModelName, { text: [text] })

  return (out as { data: number[][] }).data[0]
}
