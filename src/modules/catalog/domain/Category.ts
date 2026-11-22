import { DomainError } from '../../../shared';
import { requireText } from './validation';

export interface CategoryProps {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
}

/** Campurile modificabile ale unei categorii; `undefined` = ramane neschimbat. */
export type CategoryChanges = {
  readonly [K in keyof Omit<CategoryProps, 'id'>]?: CategoryProps[K] | undefined;
};

export class Category {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;

  private constructor(props: CategoryProps) {
    this.id = props.id;
    this.name = props.name;
    this.parentId = props.parentId;
  }

  static create(props: CategoryProps): Category {
    if (props.parentId === props.id) {
      throw new DomainError('O categorie nu poate fi propriul parinte', 'VALIDATION_ERROR');
    }
    return new Category({
      id: props.id,
      name: requireText(props.name, 'Numele categoriei', 100),
      parentId: props.parentId,
    });
  }

  withChanges(changes: CategoryChanges): Category {
    return Category.create({
      id: this.id,
      name: changes.name ?? this.name,
      parentId: changes.parentId === undefined ? this.parentId : changes.parentId,
    });
  }
}

export interface CategoryNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly children: CategoryNode[];
}

/** Arborele de categorii (self-reference prin parentId), construit din lista plata a repository-ului. */
export class CategoryTree {
  private readonly childrenByParent = new Map<string | null, Category[]>();
  private readonly byId = new Map<string, Category>();

  private constructor(categories: readonly Category[]) {
    for (const category of categories) {
      this.byId.set(category.id, category);
    }
    for (const category of categories) {
      // Un parinte lipsa face din categorie o radacina (nu pierdem noduri orfane).
      const key =
        category.parentId !== null && this.byId.has(category.parentId) ? category.parentId : null;
      const siblings = this.childrenByParent.get(key) ?? [];
      siblings.push(category);
      this.childrenByParent.set(key, siblings);
    }
  }

  static from(categories: readonly Category[]): CategoryTree {
    return new CategoryTree(categories);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Id-ul categoriei si al tuturor descendentilor ei (parcurgere in latime, rezistenta la cicluri). */
  subtreeIds(id: string): string[] {
    if (!this.byId.has(id)) return [];
    const result: string[] = [];
    const visited = new Set<string>();
    const queue = [id];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      if (visited.has(current)) continue;
      visited.add(current);
      result.push(current);
      for (const child of this.childrenByParent.get(current) ?? []) {
        queue.push(child.id);
      }
    }
    return result;
  }

  hasChildren(id: string): boolean {
    return (this.childrenByParent.get(id) ?? []).length > 0;
  }

  /** Arborele ca noduri imbricate, sortate dupa nume. */
  toNodes(): CategoryNode[] {
    const build = (category: Category, path: ReadonlySet<string>): CategoryNode => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      children: (this.childrenByParent.get(category.id) ?? [])
        .filter((child) => !path.has(child.id))
        .sort(byName)
        .map((child) => build(child, new Set([...path, child.id]))),
    });
    return [...(this.childrenByParent.get(null) ?? [])]
      .sort(byName)
      .map((root) => build(root, new Set([root.id])));
  }
}

function byName(a: Category, b: Category): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
