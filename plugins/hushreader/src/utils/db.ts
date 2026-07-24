const db = () => (window as any).ztools?.db
const dbp = () => (window as any).ztools?.db?.promises

export async function saveCover(bookId: string, coverData: string) {
  try {
    const p = dbp()
    if (!p) return
    const existing = await p.get(`cover_${bookId}`).catch(() => null)
    if (existing) {
      await p.put({ ...existing, data: coverData })
    } else {
      await p.put({ _id: `cover_${bookId}`, data: coverData })
    }
  } catch (e) {
    console.warn('[db] saveCover failed', e)
  }
}

export async function loadCover(bookId: string): Promise<string | null> {
  try {
    const p = dbp()
    if (!p) return null
    const doc = await p.get(`cover_${bookId}`).catch(() => null)
    return doc?.data ?? null
  } catch {
    return null
  }
}

export async function removeCover(bookId: string) {
  try {
    const p = dbp()
    if (!p) return
    const doc = await p.get(`cover_${bookId}`).catch(() => null)
    if (doc) await p.remove(doc)
  } catch (e) {
    console.warn('[db] removeCover failed', e)
  }
}

export async function saveCustomCover(bookId: string, coverData: string) {
  try {
    const p = dbp()
    if (!p) return
    const existing = await p.get(`custom_cover_${bookId}`).catch(() => null)
    if (existing) {
      await p.put({ ...existing, data: coverData })
    } else {
      await p.put({ _id: `custom_cover_${bookId}`, data: coverData })
    }
  } catch (e) {
    console.warn('[db] saveCustomCover failed', e)
  }
}

export async function loadCustomCover(bookId: string): Promise<string | null> {
  try {
    const p = dbp()
    if (!p) return null
    const doc = await p.get(`custom_cover_${bookId}`).catch(() => null)
    return doc?.data ?? null
  } catch {
    return null
  }
}

export async function removeCustomCover(bookId: string) {
  try {
    const p = dbp()
    if (!p) return
    const doc = await p.get(`custom_cover_${bookId}`).catch(() => null)
    if (doc) await p.remove(doc)
  } catch (e) {
    console.warn('[db] removeCustomCover failed', e)
  }
}

export async function saveChapters(bookId: string, chapters: any[]) {
  try {
    const p = dbp()
    if (!p) return
    const existing = await p.get(`chapters_${bookId}`).catch(() => null)
    if (existing) {
      await p.put({ ...existing, data: chapters })
    } else {
      await p.put({ _id: `chapters_${bookId}`, data: chapters })
    }
  } catch (e) {
    console.warn('[db] saveChapters failed', e)
  }
}

export async function loadChapters(bookId: string): Promise<any[] | null> {
  try {
    const p = dbp()
    if (!p) return null
    const doc = await p.get(`chapters_${bookId}`).catch(() => null)
    return Array.isArray(doc?.data) ? doc.data : null
  } catch {
    return null
  }
}

export async function removeChapters(bookId: string) {
  try {
    const p = dbp()
    if (!p) return
    const doc = await p.get(`chapters_${bookId}`).catch(() => null)
    if (doc) await p.remove(doc)
  } catch (e) {
    console.warn('[db] removeChapters failed', e)
  }
}

export async function removeBookData(bookId: string) {
  await Promise.allSettled([
    removeCover(bookId),
    removeCustomCover(bookId),
    removeChapters(bookId)
  ])
}

export async function loadAllCovers(bookIds: string[]): Promise<Record<string, { cover?: string; customCover?: string }>> {
  const result: Record<string, { cover?: string; customCover?: string }> = {}
  await Promise.allSettled(
    bookIds.map(async (id) => {
      const [cover, customCover] = await Promise.all([
        loadCover(id),
        loadCustomCover(id)
      ])
      const entry: { cover?: string; customCover?: string } = {}
      if (cover) entry.cover = cover
      if (customCover) entry.customCover = customCover
      if (cover || customCover) result[id] = entry
    })
  )
  return result
}
