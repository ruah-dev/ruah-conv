import type { HttpMethod, Tool } from "../ir/schema.js";
import { normalizeToolName } from "../naming/index.js";

export interface PathFamily {
	id: string;
	resource: string;
	version: string | null;
	basePath: string;
	/** Static resource segments after an optional /vN prefix. */
	depth: number;
}

export function splitPath(path: string): string[] {
	return path.split("/").filter(Boolean);
}

export function isPathParam(segment: string): boolean {
	return (
		(segment.startsWith("{") && segment.endsWith("}")) ||
		segment.startsWith(":")
	);
}

export function isVersionSegment(segment: string): boolean {
	return /^v\d+$/i.test(segment);
}

/**
 * Cluster key for an endpoint.
 *
 * - `/pets` and `/pets/{id}` share `pets`
 * - `/pets/{id}/photos` is a separate family `pets/photos`
 * - `/v1/users` and `/v2/users` do not merge (version is part of the id)
 */
export function familyFromPath(path: string): PathFamily {
	const segments = splitPath(path);
	let index = 0;
	let version: string | null = null;
	if (segments[0] && isVersionSegment(segments[0])) {
		version = segments[0].toLowerCase();
		index = 1;
	}

	const resources: string[] = [];
	for (; index < segments.length; index++) {
		const segment = segments[index];
		if (!isPathParam(segment)) {
			resources.push(segment);
		}
	}

	if (resources.length === 0) {
		const id = version ?? "root";
		return {
			id,
			resource: id,
			version,
			basePath: version ? `/${version}` : "/",
			depth: 0,
		};
	}

	const id = version
		? `${version}/${resources.join("/")}`
		: resources.join("/");
	const resource = resources[resources.length - 1] ?? "root";
	const baseParts = [version, ...resources].filter((part): part is string =>
		Boolean(part),
	);
	return {
		id,
		resource,
		version,
		basePath: `/${baseParts.join("/")}`,
		depth: resources.length,
	};
}

export function endsWithPathParam(path: string): boolean {
	const segments = splitPath(path);
	const last = segments[segments.length - 1];
	return last !== undefined && isPathParam(last);
}

function lastStaticSegment(path: string): string | undefined {
	const segments = splitPath(path);
	for (let i = segments.length - 1; i >= 0; i--) {
		const segment = segments[i];
		if (!isPathParam(segment) && !isVersionSegment(segment)) {
			return segment;
		}
	}
	return undefined;
}

/**
 * Stable action name inside a family (`list` / `get` / `create` / …).
 * Verb-like trailing segments (`/adopt`) become the action for item POSTs.
 */
export function actionFor(method: HttpMethod, path: string): string {
	const item = endsWithPathParam(path);
	switch (method) {
		case "GET":
			return item ? "get" : "list";
		case "POST":
			if (item) {
				const last = lastStaticSegment(path);
				return last ? camelSegment(last) : "submit";
			}
			return "create";
		case "PUT":
			return "replace";
		case "PATCH":
			return "update";
		case "DELETE":
			return "delete";
		case "HEAD":
			return "head";
		case "OPTIONS":
			return "options";
	}
}

export function taskToolName(resource: string, version: string | null): string {
	const base = normalizeToolName(`manage_${resource}`);
	if (!version) return base;
	const suffix = version.replace(/^v/i, "V");
	return `${base}${suffix}`;
}

export function toolIdentity(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

export function identityOf(tool: Pick<Tool, "method" | "path">): string {
	return toolIdentity(tool.method, tool.path);
}

function camelSegment(segment: string): string {
	return normalizeToolName(segment);
}

export function uniquifyActions(actions: string[]): string[] {
	const seen = new Map<string, number>();
	return actions.map((action) => {
		const count = seen.get(action) ?? 0;
		seen.set(action, count + 1);
		return count === 0 ? action : `${action}${count + 1}`;
	});
}
