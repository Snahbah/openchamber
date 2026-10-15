/**
 * Writes a promoted memory entry into the Agents Vault as a Markdown note.
 *
 * The vault is a human-curated Obsidian store nested inside the openchamber
 * working tree. The promotion bridge writes only into its own `Artifacts/`
 * namespace, keyed by memory id, so a re-promotion updates the same note rather
 * than duplicating it, and never touches the files a human curates.
 *
 * The bridge never runs git and never deletes anything except its own temporary
 * file. A failed write leaves the previous note in place.
 */

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9_-]/g;

const sanitizeFileName = (value) => String(value).replace(UNSAFE_FILENAME_CHARS, '_');

const toIsoTimestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

/**
 * YAML frontmatter plus a Markdown body. `id`, `title` and `created` are
 * double-quoted (JSON string literals are valid YAML scalars) so a title that
 * happens to contain a colon or a quote cannot break the document. `type` and
 * `scope` are closed tokens and stay bare.
 */
const formatNote = (entry, scope) => [
  '---',
  `id: ${JSON.stringify(entry.id)}`,
  `title: ${JSON.stringify(entry.title)}`,
  `type: ${entry.type}`,
  `scope: ${scope}`,
  `created: ${JSON.stringify(toIsoTimestamp(entry.createdAt))}`,
  'salience: promoted',
  // Read-only projection of memory.json. The store is the source of truth; a
  // hand-edit to this note diverges it from the store, and the next re-promotion
  // overwrites the edit. `generated: true` is the machine-readable marker of that.
  'generated: true',
  'tags:',
  `  - ${entry.type}`,
  `  - ${scope}`,
  '---',
  '',
  `# ${entry.title}`,
  '',
  entry.body,
  '',
].join('\n');

/**
 * The note shape for a distilled Session Learning (Rev PRD-07 §4). Distinct from
 * a memory entry: it carries a summary and a cost, not a title and body, and its
 * `type: session_learning` is what the read path filters on to surface it as a
 * `[recall — session_learning]` block rather than a fact.
 */
const formatSessionLearningNote = (learning, sessionId, domain, index) => [
  '---',
  `id: ${JSON.stringify(`sl_${sessionId}_${index}`)}`,
  'type: session_learning',
  `summary: ${JSON.stringify(learning.summary)}`,
  `cost: ${learning.cost}`,
  `verified: ${learning.verified}`,
  `sessionId: ${JSON.stringify(sessionId)}`,
  `domain: ${JSON.stringify(domain)}`,
  'generated: true',
  '---',
  '',
  learning.summary,
  '',
].join('\n');

export const createVaultPromotionRuntime = ({ fsPromises, path, vaultArtifactsDir }) => {
  if (!vaultArtifactsDir?.trim()) {
    throw new Error('vaultArtifactsDir is required');
  }

  const resolveNotePath = (entry) => path.join(vaultArtifactsDir, `${sanitizeFileName(entry.id)}.md`);

  const writeAtomic = async (filePath, content) => {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fsPromises.writeFile(temporaryPath, content, 'utf8');
      await fsPromises.rename(temporaryPath, filePath);
    } catch (error) {
      // Remove only our own temporary file; never anything that could be a
      // human's note, and never a recursive delete.
      await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  };

  /**
   * Promote a memory entry into the vault. Returns the note's path and id, or
   * throws when the write fails. The source memory.json entry is never touched.
   */
  const promote = async (entry, scope) => {
    const notePath = resolveNotePath(entry);
    await writeAtomic(notePath, formatNote(entry, scope));
    return { noteId: entry.id, path: notePath };
  };

  /**
   * Promote one distilled Session Learning (Rev PRD-07 §4). Keyed by a
   * deterministic `sl_<sessionId>_<index>` id, so a re-run of the mirror
   * overwrites the same note rather than duplicating it. Only VERIFIED learnings
   * should ever reach this — the caller filters quarantined ones out first.
   */
  const promoteSessionLearning = async (learning, sessionId, domain, index) => {
    const noteId = `sl_${sessionId}_${index}`;
    const notePath = path.join(vaultArtifactsDir, `${sanitizeFileName(noteId)}.md`);
    await writeAtomic(notePath, formatSessionLearningNote(learning, sessionId, domain, index));
    return { noteId, path: notePath };
  };

  return { promote, promoteSessionLearning, formatNote, formatSessionLearningNote, resolveNotePath };
};
