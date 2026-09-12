// FOUNDATION STUB — copied verbatim from msr-app-replit/apps/api/src/zod-validation.ts.
//
// Zod as Fastify's request validator. This is the whole of what
// `fastify-type-provider-zod` gives us, minus the swagger integration it
// declares as a REQUIRED peer. Two documented Fastify extension points: a
// validator compiler, and a type provider.
//
// The point is that a route describes its input ONCE. `req.body` takes its type
// from the same schema that refuses a bad one at run time, so the two cannot
// disagree.
//
// ⚠️ This checks the ENVELOPE, never the contents. Whether `zoneCode` is a
// string is Zod's; whether that zone is open this edition belongs to the domain.
import type { FastifyInstance, FastifyTypeProvider } from 'fastify';
import type { z } from 'zod';

/** Makes `req.body`, `req.query` and `req.params` take their types from the Zod
 *  schema declared on the route, so the description is written once. */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}

/** One line per bad field: `zoneCode: expected string, received number`.
 *
 *  Named fields rather than a bare "invalid request", because the caller has to
 *  know WHICH one to fix — a refusal that does not say turns a fixable mistake
 *  into a support call. */
function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      const message = issue.message.replace(/^Invalid input:\s*/, '');
      return path ? `${path}: ${message}` : message;
    })
    .join('; ');
}

/** Hand Fastify a Zod schema wherever a route declares one. A failure returns
 *  an `Error` carrying a 400, which the shared error handler passes through
 *  with its message intact — a validation failure IS the caller's fault, and
 *  unlike our own errors it should say so. */
export function useZodValidation(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => (data) => {
    const result = (schema as unknown as z.ZodType).safeParse(data);
    if (result.success) return { value: result.data };

    const failure = Object.assign(new Error(describe(result.error)), { statusCode: 400 });
    return { error: failure };
  });
}
