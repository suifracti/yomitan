export function visitTranslationTargets(root: Element, options: {autoScan:string,selector:string,ignoreSelector:string,isBlock:(node:Element)=>boolean,hasText:(node:Element)=>boolean,wrapperClass:string}, visit:(node:Element)=>void):void;
export function isInNonContent(node:Node):boolean;
