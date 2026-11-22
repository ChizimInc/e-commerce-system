import { describe, expect, it } from 'vitest';
import { Category, CategoryTree } from '../../../src/modules/catalog/domain/Category';
import { makeCategory } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';

const electronics = makeCategory(uuid(1), 'Electronice');
const laptops = makeCategory(uuid(2), 'Laptopuri', uuid(1));
const gaming = makeCategory(uuid(3), 'Gaming', uuid(2));
const books = makeCategory(uuid(4), 'Carti');

describe('Category', () => {
  it('refuza numele gol si o categorie ca propriul parinte', () => {
    expect(() => makeCategory(uuid(9), '  ')).toThrowError();
    expect(() => Category.create({ id: uuid(9), name: 'X', parentId: uuid(9) })).toThrowError(
      /propriul parinte/,
    );
  });

  it('withChanges poate muta categoria la radacina (parentId: null)', () => {
    expect(laptops.withChanges({ parentId: null }).parentId).toBeNull();
    expect(laptops.withChanges({ name: 'Notebook' }).parentId).toBe(uuid(1));
  });
});

describe('CategoryTree', () => {
  const tree = CategoryTree.from([gaming, books, laptops, electronics]);

  it('subtreeIds include categoria si toti descendentii ei', () => {
    expect(tree.subtreeIds(uuid(1)).sort()).toEqual([uuid(1), uuid(2), uuid(3)].sort());
    expect(tree.subtreeIds(uuid(3))).toEqual([uuid(3)]);
    expect(tree.subtreeIds(uuid(999))).toEqual([]);
  });

  it('toNodes construieste arborele imbricat, sortat dupa nume', () => {
    const nodes = tree.toNodes();
    expect(nodes.map((n) => n.name)).toEqual(['Carti', 'Electronice']);
    const electronicsNode = nodes[1];
    expect(electronicsNode?.children.map((n) => n.name)).toEqual(['Laptopuri']);
    expect(electronicsNode?.children[0]?.children.map((n) => n.name)).toEqual(['Gaming']);
  });

  it('hasChildren si has', () => {
    expect(tree.hasChildren(uuid(1))).toBe(true);
    expect(tree.hasChildren(uuid(4))).toBe(false);
    expect(tree.has(uuid(2))).toBe(true);
    expect(tree.has(uuid(999))).toBe(false);
  });

  it('o categorie cu parinte inexistent devine radacina (nu se pierde)', () => {
    const orphan = makeCategory(uuid(5), 'Orfana', uuid(777));
    expect(
      CategoryTree.from([orphan])
        .toNodes()
        .map((n) => n.name),
    ).toEqual(['Orfana']);
  });

  it('nu intra in bucla infinita pe date cu ciclu', () => {
    const a = makeCategory(uuid(10), 'A', uuid(11));
    const b = makeCategory(uuid(11), 'B', uuid(10));
    const cyclic = CategoryTree.from([a, b]);
    expect(cyclic.subtreeIds(uuid(10)).sort()).toEqual([uuid(10), uuid(11)].sort());
    expect(cyclic.toNodes()).toEqual([]); // nicio radacina, dar nu blocheaza
  });
});
