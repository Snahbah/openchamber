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

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]/g;

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

  return { promote, formatNote, resolveNotePath };
};
