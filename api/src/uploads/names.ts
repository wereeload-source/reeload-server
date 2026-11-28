/** File names go into object keys: keep letters, digits, dot, dash, underscore. */
export const safeName = (n: string): string => n.replace(/[^\w.-]+/g, '_').slice(-120);
