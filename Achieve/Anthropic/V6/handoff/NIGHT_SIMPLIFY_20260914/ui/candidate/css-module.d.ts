// 候选本地类型声明：CSS module（仅候选仓库用；site 集成后由 Next 自带类型接管）。
declare module '*.module.css' {
  const styles: Readonly<Record<string, string>>;
  export default styles;
}
