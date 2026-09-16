import { readFileSync } from 'node:fs';
import { createDemoProjection } from './demo-state.mjs';

const app = readFileSync('app.js', 'utf8');
const html = readFileSync('index.html', 'utf8');
const server = readFileSync('serve.mjs', 'utf8');
const css = `${readFileSync('styles.css', 'utf8')}\n${readFileSync('overrides.css', 'utf8')}`;
const pageTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
const projection = createDemoProjection();
const expected = ['风控业务协同','需求开发协同','人机交互协同','内容生产协同','经营增长协同','物理智能协同','知识办公协同','客户服务协同','供应链履约协同','医疗服务协同'];
const check = (ok, label) => { console.log(`${ok ? '通过' : '失败'}　${label}`); if (!ok) process.exitCode = 1; };

check(projection.scenarios.map((scene) => scene.name).join('、') === expected.join('、'), '十个场景顺序固定且完整');
check(projection.scenarios.every((scene) => scene.nodes.length >= 8 && scene.edges.length >= 7 && scene.stages.length >= 7 && scene.matrix.length >= 5), '十场景均具备关系、进度与矩阵数据');
check(projection.scenarios.filter((scene) => scene.view === '进度').map((scene) => scene.name).join('、') === '风控业务协同、需求开发协同、内容生产协同、知识办公协同、客户服务协同、医疗服务协同', '六个场景默认进度视图');
check(projection.scenarios.filter((scene) => scene.view === '关系').map((scene) => scene.name).join('、') === '人机交互协同、物理智能协同', '两个场景默认关系视图');
check(projection.scenarios.filter((scene) => scene.view === '矩阵').map((scene) => scene.name).join('、') === '经营增长协同、供应链履约协同', '两个场景默认矩阵视图');
check(projection.scenarios.find((scene) => scene.id === '物理').special.includes('智能网联汽车') && projection.scenarios.find((scene) => scene.id === '医疗').special.includes('诊疗辅助、质控、随访'), '物理与医疗范围提示常显');
check(/frontend-config/.test(server) && /P1_FRONTEND_MODE === 'demo'/.test(server) && /PROJECTION_UNAVAILABLE/.test(server), '演示模式由服务端显式开关，产品模式失败关闭');
check(/onwheel/.test(app) && /ctrlKey/.test(app) && /data-graph/.test(app) && /localStorage/.test(app), '关系图支持平移、缩放、按钮与本地布局');
check(/cycle-card/.test(app) && /循环与恢复依据/.test(app) && /matrix-cell/.test(app), '进度循环与矩阵下钻存在');
check(/普通消息不会触发模型/.test(app) && /生成候选/.test(app) && /候选产物待审/.test(app), '普通消息与模型运行明确分离');
check(/projectionVersion !== scene\.eventCursor - 200/.test(app) && /场景范围或顺序不一致/.test(app), '三视图共用投影且版本不一致失败关闭');
check(!/查看全局|全局动态/.test(html + app), '旧左下全局动态入口不存在');
check(pageTitle.length > 0 && !/[A-Za-z]/.test(pageTitle), '浏览器标题仅使用中文与中文标点');
check(!/(#[0-9a-f]{3,8}|rgb\(|hsl\()/ig.test(css.replace(/#(?:101010|383838|707070|bdbdbd|dfdfdf|f4f4f4|ffffff|fff|f0f0f0)\b/ig, '')), '样式仅使用黑白灰');
