/** Keep inline-copy actions on their selected line and size menus to their labels. */
import { readFile } from 'node:fs/promises';

/** Build adapter for pinned Monaco menus; installed dependency files remain unchanged. */
export const diffMenuPlugin = {
  name: 'dsh-diff-menu',
  setup(build) {
    build.onLoad({ filter: /[/\\]ui[/\\]menu[/\\]menu\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const styles = await readFile(new URL('../src/diff-menu.css', import.meta.url), 'utf8');
      const marker = '    return result;';
      if (source.split(marker).length !== 2 || !source.includes('function getMenuWidgetCSS(')) {
        throw new Error('Unsupported Monaco menu stylesheet implementation');
      }
      return { loader: 'js', contents: source.replace(marker, `    return result + ${JSON.stringify(styles)};`) };
    });
    build.onLoad({ filter: /inlineDiffDeletedCodeMargin\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const marker = 'getActions: () => {';
      const coordinate = '_diff.original.startLineNumber + currentLineNumberOffset';
      if (!source.includes(marker) || source.split(coordinate).length !== 4) {
        throw new Error('Unsupported Monaco inline-copy implementation');
      }
      return { loader: 'js', contents: source.replace(marker, marker + '\nconst selectedLineNumberOffset = currentLineNumberOffset;')
        .replaceAll(coordinate, '_diff.original.startLineNumber + selectedLineNumberOffset') };
    });
  },
};
