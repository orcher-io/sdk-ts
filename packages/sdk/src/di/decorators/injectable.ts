/**
 * The `@Injectable()` class decorator and helpers for inspecting injectable classes.
 *
 * `@Injectable()` registers a class with the global registry so the container can create it and
 * inject its dependencies. The scope option controls instance lifetime.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/ban-types, @typescript-eslint/restrict-template-expressions */
// Decorator signatures are typed with `any` and `Function`.

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { InjectableOptions, Type, ServiceMetadata, Scope } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a class as an injectable service and registers it with the global registry.
 *
 * The container uses the stored metadata to create the class and inject its constructor
 * dependencies. The scope defaults to `'singleton'`. `'scoped'` is accepted, but per-workflow
 * scoping is not supported yet: the worker registers `scoped` services as singletons.
 *
 * @param options - Service options. `scope` sets the instance lifetime.
 * @returns A class decorator.
 * @throws DecoratorError if applied to something other than a class.
 * @throws Error if `scope` is not `'singleton'`, `'transient'`, or `'scoped'`.
 *
 * @example
 * Basic usage (singleton by default):
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(
 *     private logger: LoggerService,
 *     private db: DatabaseService
 *   ) {}
 *
 *   async findUser(id: string) {
 *     this.logger.log(`Finding user ${id}`);
 *     return this.db.query('users', { id });
 *   }
 * }
 * ```
 *
 * @example
 * Transient scope (new instance each time):
 * ```typescript
 * @Injectable({ scope: 'transient' })
 * export class RequestContext {
 *   private startTime = Date.now();
 *
 *   getElapsedTime() {
 *     return Date.now() - this.startTime;
 *   }
 * }
 * ```
 *
 * @example
 * With lifecycle hooks:
 * ```typescript
 * @Injectable()
 * export class DatabaseService implements OnInit, OnDestroy {
 *   private connection?: Connection;
 *
 *   onInit() {
 *     this.connection = createConnection();
 *   }
 *
 *   async onDestroy() {
 *     await this.connection?.close();
 *   }
 * }
 * ```
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return function <T extends Function>(target: T): T {
    if (typeof target !== 'function') {
      throw DecoratorError.cannotApplyToNonClass('@Injectable', typeof target);
    }

    const scope: Scope = options.scope || 'singleton';

    if (scope !== 'singleton' && scope !== 'transient' && scope !== 'scoped') {
      throw new Error(
        `@Injectable: Invalid scope "${scope}". Must be "singleton", "transient", or "scoped".`
      );
    }

    const metadata: ServiceMetadata = {
      token: target as unknown as Type<any>,
      scope,
      registered: true,
    };

    Reflect.defineMetadata('injectable', true, target);
    Reflect.defineMetadata('injectable:scope', scope, target);
    Reflect.defineMetadata('injectable:metadata', metadata, target);

    const registry = GlobalRegistry.getInstance();
    registry.registerService(target as unknown as Type<any>, metadata);

    Reflect.defineMetadata('di:decorated', true, target);

    return target;
  };
}

/**
 * Returns whether a class is decorated with `@Injectable()`.
 *
 * @param target - Class to check
 * @returns true if the class is decorated with @Injectable
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {}
 *
 * isInjectable(MyService); // true
 * isInjectable(class Other {}); // false
 * ```
 */
export function isInjectable(target: any): boolean {
  if (!target || typeof target !== 'function') {
    return false;
  }
  return Reflect.getMetadata('injectable', target) === true;
}

/**
 * Returns the scope declared by `@Injectable()` on a class.
 *
 * @param target - Class to get scope from
 * @returns The declared scope, or undefined if the class is not injectable
 *
 * @example
 * ```typescript
 * @Injectable({ scope: 'transient' })
 * class MyService {}
 *
 * getInjectableScope(MyService); // 'transient'
 * ```
 */
export function getInjectableScope(target: any): Scope | undefined {
  if (!isInjectable(target)) {
    return undefined;
  }
  return Reflect.getMetadata('injectable:scope', target);
}

/**
 * Returns the service metadata `@Injectable()` stored on a class.
 *
 * @param target - Class to get metadata from
 * @returns Service metadata, or undefined if not injectable
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {}
 *
 * const metadata = getInjectableMetadata(MyService);
 * console.log(metadata.scope); // 'singleton'
 * ```
 */
export function getInjectableMetadata(target: any): ServiceMetadata | undefined {
  if (!isInjectable(target)) {
    return undefined;
  }
  return Reflect.getMetadata('injectable:metadata', target);
}
