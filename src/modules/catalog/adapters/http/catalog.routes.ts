import { Router, type Request, type RequestHandler } from 'express';
import { idParamsSchema } from '../../../../infrastructure/http/common-schemas';
import type { CatalogAdminService } from '../../ports/in/CatalogAdminService';
import type { CatalogQueries } from '../../ports/in/CatalogQueries';
import {
  toBundleResponse,
  toCategoryResponse,
  toProductPageResponse,
  toProductResponse,
} from './catalog.mappers';
import {
  createBundleSchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  updateBundleSchema,
  updateCategorySchema,
  updateProductSchema,
} from './catalog.schemas';

export interface CatalogAdminRoutes {
  /** Middleware-uri aplicate inaintea fiecarei rute de administrare (autentificare + rol ADMIN). */
  readonly guards: readonly RequestHandler[];
  /** Serviciul de administrare pentru cererea curenta (de regula protejat de `AuthorizationProxy`). */
  readonly serviceFor: (req: Request) => CatalogAdminService;
}

export interface CatalogRouterDependencies {
  readonly queries: CatalogQueries;
  /**
   * Rutele de administrare se monteaza DOAR daca sunt furnizate impreuna cu garzile lor:
   * fara ele, catalogul expune exclusiv citirea (securizat implicit).
   */
  readonly admin?: CatalogAdminRoutes | undefined;
}

/** Adaptor inbound REST pentru catalog: public pentru citire, protejat pentru administrare. */
export function createCatalogRouter({ queries, admin }: CatalogRouterDependencies): Router {
  const router = Router();

  // ---- Citire (public) ----

  router.get('/products', async (req, res) => {
    const { q, categoryId, limit, offset } = listProductsQuerySchema.parse(req.query);
    const page = await queries.listProducts({ query: q, categoryId, limit, offset });
    res.json(toProductPageResponse(page));
  });

  router.get('/products/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(toProductResponse(await queries.getProduct(id)));
  });

  router.get('/categories', async (_req, res) => {
    res.json({ items: await queries.listCategories() });
  });

  router.get('/bundles', async (_req, res) => {
    const bundles = await queries.listBundles();
    res.json({ items: bundles.map(toBundleResponse) });
  });

  router.get('/bundles/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(toBundleResponse(await queries.getBundle(id)));
  });

  // ---- Administrare ----

  if (admin) {
    const { guards, serviceFor } = admin;

    router.post('/products', ...guards, async (req, res) => {
      const body = createProductSchema.parse(req.body);
      res.status(201).json(toProductResponse(await serviceFor(req).createProduct(body)));
    });

    router.patch('/products/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      const body = updateProductSchema.parse(req.body);
      res.json(toProductResponse(await serviceFor(req).updateProduct(id, body)));
    });

    router.delete('/products/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      await serviceFor(req).deleteProduct(id);
      res.status(204).end();
    });

    router.post('/categories', ...guards, async (req, res) => {
      const body = createCategorySchema.parse(req.body);
      res.status(201).json(toCategoryResponse(await serviceFor(req).createCategory(body)));
    });

    router.patch('/categories/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      const body = updateCategorySchema.parse(req.body);
      res.json(toCategoryResponse(await serviceFor(req).updateCategory(id, body)));
    });

    router.delete('/categories/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      await serviceFor(req).deleteCategory(id);
      res.status(204).end();
    });

    router.post('/bundles', ...guards, async (req, res) => {
      const body = createBundleSchema.parse(req.body);
      res.status(201).json(toBundleResponse(await serviceFor(req).createBundle(body)));
    });

    router.patch('/bundles/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      const body = updateBundleSchema.parse(req.body);
      res.json(toBundleResponse(await serviceFor(req).updateBundle(id, body)));
    });

    router.delete('/bundles/:id', ...guards, async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      await serviceFor(req).deleteBundle(id);
      res.status(204).end();
    });
  }

  return router;
}
