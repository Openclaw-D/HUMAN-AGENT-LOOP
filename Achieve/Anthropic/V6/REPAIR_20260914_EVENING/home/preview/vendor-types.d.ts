// 候选隔离 typecheck 用：CSS Module 与资源声明（仅 preview 本地，不拷入 site——
// site 由 next-env 提供同等声明）。
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
