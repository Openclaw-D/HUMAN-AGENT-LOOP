import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { addEvidence, createContext, listContexts, reconsiderContext, recordRiskDecision, runRound, type AgentId, type CoordinationContext, type RiskOutcome } from './a2aClient'
import './App.css'

type ViewId = 'stars' | 'development' | 'profile'
type ProjectCategory = '风控' | '技术' | '数据' | '营销' | '运营'
type ProjectScale = 'small' | 'medium' | 'large'
type SortKey = 'time' | 'stars' | 'progress'
type SortDirection = 'desc' | 'asc'

interface OrbitProject {
  id: string
  name: string
  category: ProjectCategory
  scale: ProjectScale
  baseStars: number
  impactStars: number
  people: number
  openSlots: number
  openings: string
  stage: string
  automation: string
  summary: string
  position: { x: number; y: number }
}

interface MapView {
  scale: number
  x: number
  y: number
}

interface AuditProject {
  id: string
  name: string
  category: ProjectCategory
  stage: string
  baseStars: number
  impactStars: number
  releasedStars: number
  progress: number
  verificationQuarter: number
  updatedAt: string
  updatedLabel: string
  nextRelease: string
  impactMetric: string
  evidence: string
}

const navItems: Array<{ id: ViewId; label: string }> = [
  { id: 'stars', label: 'Stars 项目' },
  { id: 'development', label: '协作' },
  { id: 'profile', label: '个人与审计' },
]

const categoryOptions: Array<'全部' | ProjectCategory> = ['全部', '风控', '技术', '数据', '营销', '运营']
const categoryClass: Record<ProjectCategory, string> = {
  风控: 'risk',
  技术: 'tech',
  数据: 'data',
  营销: 'marketing',
  运营: 'operations',
}

const MAP_WIDTH = 2200
const MAP_HEIGHT = 1280
const MIN_ZOOM = .48
const MAX_ZOOM = 1.65

const categoryZones: Record<ProjectCategory, { x: number; y: number; width: number; height: number }> = {
  风控: { x: 50, y: 40, width: 660, height: 625 },
  技术: { x: 700, y: 35, width: 660, height: 640 },
  数据: { x: 1360, y: 45, width: 790, height: 630 },
  营销: { x: 45, y: 665, width: 880, height: 570 },
  运营: { x: 925, y: 670, width: 1225, height: 565 },
}

const categoryPositions: Record<ProjectCategory, Array<{ x: number; y: number }>> = {
  风控: [{ x: 100, y: 145 }, { x: 330, y: 70 }, { x: 535, y: 180 }, { x: 60, y: 365 }, { x: 285, y: 320 }, { x: 515, y: 425 }, { x: 180, y: 535 }, { x: 430, y: 545 }],
  技术: [{ x: 745, y: 105 }, { x: 965, y: 155 }, { x: 1185, y: 70 }, { x: 705, y: 350 }, { x: 940, y: 305 }, { x: 1195, y: 395 }, { x: 815, y: 535 }, { x: 1085, y: 520 }],
  数据: [{ x: 1405, y: 125 }, { x: 1655, y: 65 }, { x: 1905, y: 175 }, { x: 1385, y: 350 }, { x: 1660, y: 305 }, { x: 1935, y: 410 }, { x: 1490, y: 530 }, { x: 1810, y: 545 }],
  营销: [{ x: 90, y: 770 }, { x: 350, y: 700 }, { x: 605, y: 785 }, { x: 130, y: 1010 }, { x: 400, y: 975 }, { x: 650, y: 1080 }, { x: 790, y: 855 }, { x: 805, y: 1095 }],
  运营: [{ x: 965, y: 745 }, { x: 1225, y: 690 }, { x: 1500, y: 790 }, { x: 1840, y: 730 }, { x: 1015, y: 1015 }, { x: 1305, y: 1060 }, { x: 1590, y: 1000 }, { x: 1885, y: 1085 }],
}

const projectCatalog: Record<ProjectCategory, Array<[string, string]>> = {
  风控: [['风险证据链', '协作开发'], ['合同审查助手', '审计联调'], ['尽调异常雷达', '样本验证'], ['授信规则台', '规则建模'], ['现金流预警', '数据接入'], ['反欺诈样本库', '组队中'], ['审批复核助手', '原型验证'], ['风险口径地图', '需求确认']],
  技术: [['联调协作台', '接口联调'], ['测试轨道', '组队中'], ['接口契约中心', '协作开发'], ['发布守门员', '灰度验证'], ['日志诊断台', '原型验证'], ['权限策略引擎', '规则建模'], ['低代码连接器', '需求确认'], ['性能巡检站', '效果验证']],
  数据: [['知识清洗引擎', '效果验证'], ['指标实验室', '口径确认'], ['主数据治理', '协作开发'], ['数据血缘图', '接口联调'], ['报表自动核对', '原型验证'], ['样本质量哨兵', '组队中'], ['知识检索台', '效果验证'], ['经营预测仓', '需求确认']],
  营销: [['增长内容工厂', '需求确认'], ['线索路由器', '原型验证'], ['客户画像台', '口径确认'], ['活动复盘器', '效果验证'], ['渠道素材库', '组队中'], ['商机评分器', '规则建模'], ['投放归因链', '数据接入'], ['销售话术库', '协作开发']],
  运营: [['运营脉冲', '快速验证'], ['客户闭环', '协作开发'], ['工单分流器', '规则建模'], ['流程挖掘台', '效果验证'], ['会议行动台', '原型验证'], ['采购协同网', '需求确认'], ['服务质量盘', '数据接入'], ['重复工作清单', '组队中']],
}

const categorySummary: Record<ProjectCategory, string> = {
  风控: '把判断依据、风险质询与人工复核过程沉淀为可追溯证据。',
  技术: '减少跨系统联调和重复开发，让交付过程更稳定、可复用。',
  数据: '统一数据来源、指标口径与质量记录，为业务判断提供可信底座。',
  营销: '连接线索、内容与转化证据，验证增长动作的真实贡献。',
  运营: '识别重复工作并建立标准流程，持续降低人工协作损耗。',
}

const scalePattern: ProjectScale[] = ['large', 'medium', 'medium', 'small', 'large', 'small', 'medium', 'small']
const automationPattern = ['影子运行', 'AI 辅助', '人工复核', '自动执行']

const orbitProjects: OrbitProject[] = categoryOptions.slice(1).flatMap((category, categoryIndex) => {
  const typedCategory = category as ProjectCategory
  return projectCatalog[typedCategory].map(([name, stage], projectIndex) => {
    const projectScale = scalePattern[(projectIndex + categoryIndex) % scalePattern.length]
    const scaleWeight = { small: 0, medium: 1, large: 2 }[projectScale]
    const openSlots = 1 + ((projectIndex + categoryIndex) % 3)
    return {
      id: `${categoryClass[typedCategory]}-${projectIndex + 1}`,
      name,
      category: typedCategory,
      scale: projectScale,
      baseStars: 18 + categoryIndex * 3 + projectIndex * 4 + scaleWeight * 11,
      impactStars: 32 + ((projectIndex * 19 + categoryIndex * 13) % 74) + scaleWeight * 26,
      people: 2 + ((projectIndex * 3 + categoryIndex) % 7) + scaleWeight * 2,
      openSlots,
      openings: `还可加入 ${openSlots} 人`,
      stage,
      automation: automationPattern[(projectIndex + categoryIndex) % automationPattern.length],
      summary: categorySummary[typedCategory],
      position: categoryPositions[typedCategory][projectIndex],
    }
  })
})

const projectDiameter: Record<ProjectScale, number> = { small: 118, medium: 154, large: 194 }
const projectRelations = [
  { from: 'risk-1', to: 'risk-2', label: '共用证据' },
  { from: 'risk-1', to: 'data-4', label: '依赖数据' },
  { from: 'risk-5', to: 'data-8', label: '持续监测' },
  { from: 'tech-1', to: 'tech-3', label: '接口复用' },
  { from: 'tech-2', to: 'tech-4', label: '验收依赖' },
  { from: 'tech-5', to: 'operations-7', label: '运行信号' },
  { from: 'data-1', to: 'data-7', label: '知识复用' },
  { from: 'data-2', to: 'marketing-3', label: '指标口径' },
  { from: 'marketing-2', to: 'operations-2', label: '线索闭环' },
  { from: 'marketing-6', to: 'data-2', label: '评分模型' },
  { from: 'operations-3', to: 'tech-7', label: '流程接入' },
  { from: 'operations-4', to: 'data-4', label: '过程数据' },
]
const projectIndex = new Map(orbitProjects.map((project) => [project.id, project]))
const mapDust = Array.from({ length: 88 }, (_, index) => ({
  x: (index * 173 + 47 + (index % 7) * 31) % MAP_WIDTH,
  y: (index * 97 + 29 + (index % 5) * 113) % MAP_HEIGHT,
  size: index % 13 === 0 ? 4 : index % 5 === 0 ? 3 : 2,
  opacity: index % 9 === 0 ? .34 : .18,
}))

function relationStyle(fromId: string, toId: string): CSSProperties | null {
  const from = projectIndex.get(fromId)
  const to = projectIndex.get(toId)
  if (!from || !to) return null
  const fromSize = projectDiameter[from.scale]
  const toSize = projectDiameter[to.scale]
  const fromX = from.position.x + fromSize / 2
  const fromY = from.position.y + fromSize / 2
  const toX = to.position.x + toSize / 2
  const toY = to.position.y + toSize / 2
  const deltaX = toX - fromX
  const deltaY = toY - fromY
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI
  return {
    left: fromX,
    top: fromY,
    width: Math.hypot(deltaX, deltaY),
    '--relation-angle': `${angle}deg`,
    '--relation-label-angle': `${-angle}deg`,
  } as CSSProperties
}

const auditProjects: AuditProject[] = [
  { id: 'equipment', name: '制造设备融资', category: '风控', stage: '复核', baseStars: 42, impactStars: 90, releasedStars: 42, progress: 72, verificationQuarter: 1, updatedAt: '2026-08-06T00:40:00', updatedLabel: '刚刚', nextRelease: '10 月 01 日 · 18 ★', impactMetric: '审批时间预计降低 46%', evidence: '合同版本、现金流样本、联调记录 12 项' },
  { id: 'factoring', name: '供应链保理', category: '数据', stage: '初审', baseStars: 36, impactStars: 78, releasedStars: 24, progress: 46, verificationQuarter: 0, updatedAt: '2026-08-05T22:00:00', updatedLabel: '2 小时前', nextRelease: '审计通过后确认', impactMetric: '预计减少 320 小时/年', evidence: '回款样本、确权函、异常规则 8 项' },
  { id: 'green', name: '绿色改造融资', category: '运营', stage: '提交', baseStars: 28, impactStars: 64, releasedStars: 0, progress: 24, verificationQuarter: 0, updatedAt: '2026-08-05T09:00:00', updatedLabel: '昨天', nextRelease: '等待初审', impactMetric: '预计复用至 6 个项目', evidence: '能耗口径、数据模板、收益模型 5 项' },
  { id: 'contract', name: '设备合同核验', category: '技术', stage: '完成', baseStars: 31, impactStars: 52, releasedStars: 70, progress: 100, verificationQuarter: 4, updatedAt: '2026-08-01T12:00:00', updatedLabel: '5 天前', nextRelease: '已全部释放', impactMetric: '全年节省 680 小时', evidence: '验收报告、运行日志、季度复核 24 项' },
]

const auditStages = ['提交', '初审', '复核', '计星', '完成']

function NavigationIcon({ id }: { id: ViewId }) {
  if (id === 'stars') return <span className="nav-symbol nav-symbol--star" aria-hidden="true">✦</span>
  if (id === 'development') return <span className="nav-symbol nav-symbol--brush" aria-hidden="true"><i /><b /></span>
  return <span className="nav-symbol nav-symbol--person" aria-hidden="true"><i /><b /></span>
}

function MemberFigures({ people, openSlots }: { people: number; openSlots: number }) {
  return (
    <span className="member-figures" aria-hidden="true">
      {Array.from({ length: Math.min(people, 4) }, (_, index) => <i className="member-figure member-figure--filled" key={`filled-${index}`} />)}
      {Array.from({ length: Math.min(openSlots, 3) }, (_, index) => <i className="member-figure member-figure--open" key={`open-${index}`} />)}
    </span>
  )
}

function StarsPage({ onDevelop }: { onDevelop: () => void }) {
  const [category, setCategory] = useState<'全部' | ProjectCategory>('全部')
  const [starFloor, setStarFloor] = useState(0)
  const [scale, setScale] = useState<'all' | ProjectScale>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [joinedIds, setJoinedIds] = useState(() => new Set<string>(['risk-1']))
  const [mapView, setMapView] = useState<MapView>({ scale: .7, x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)

  const visibleProjects = useMemo(() => orbitProjects.filter((project) => (
    (category === '全部' || project.category === category)
    && project.baseStars + project.impactStars >= starFloor
    && (scale === 'all' || project.scale === scale)
  )), [category, scale, starFloor])
  const selectedProject = orbitProjects.find((project) => project.id === selectedId) ?? null
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects])
  const zoomLevel = mapView.scale < .6 ? 'overview' : mapView.scale < 1 ? 'standard' : 'detail'

  const frameWorldRect = useCallback((worldRect: { x: number; y: number; width: number; height: number }, maximumScale = 1) => {
    const viewport = mapRef.current?.getBoundingClientRect()
    if (!viewport) return
    const padding = 56
    const nextScale = Math.max(MIN_ZOOM, Math.min(maximumScale, (viewport.width - padding * 2) / worldRect.width, (viewport.height - padding * 2) / worldRect.height))
    setMapView({
      scale: nextScale,
      x: (viewport.width - worldRect.width * nextScale) / 2 - worldRect.x * nextScale,
      y: (viewport.height - worldRect.height * nextScale) / 2 - worldRect.y * nextScale,
    })
  }, [])

  const fitMap = useCallback(() => {
    frameWorldRect({ x: 70, y: 45, width: MAP_WIDTH - 140, height: MAP_HEIGHT - 105 }, .86)
  }, [frameWorldRect])

  useEffect(() => {
    fitMap()
    const viewport = mapRef.current
    if (!viewport) return undefined
    const observer = new ResizeObserver(fitMap)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fitMap])

  function resetSelection() {
    setSelectedId(null)
  }

  function selectCategory(nextCategory: '全部' | ProjectCategory) {
    setCategory(nextCategory)
    resetSelection()
    if (nextCategory === '全部') fitMap()
    else frameWorldRect(categoryZones[nextCategory], 1.08)
  }

  function zoomAtCenter(factor: number) {
    const viewport = mapRef.current?.getBoundingClientRect()
    if (!viewport) return
    const centerX = viewport.width / 2
    const centerY = viewport.height / 2
    setMapView((current) => {
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor))
      const worldX = (centerX - current.x) / current.scale
      const worldY = (centerY - current.y) / current.scale
      return { scale: nextScale, x: centerX - worldX * nextScale, y: centerY - worldY * nextScale }
    })
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const viewport = mapRef.current?.getBoundingClientRect()
    if (!viewport) return
    const pointerX = event.clientX - viewport.left
    const pointerY = event.clientY - viewport.top
    const factor = event.deltaY > 0 ? .9 : 1.1
    setMapView((current) => {
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor))
      const worldX = (pointerX - current.x) / current.scale
      const worldY = (pointerY - current.y) / current.scale
      return { scale: nextScale, x: pointerX - worldX * nextScale, y: pointerY - worldY * nextScale }
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, select')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: mapView.x, originY: mapView.y }
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setMapView((current) => ({ ...current, x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function joinSelected(projectId: string) {
    if (joinedIds.has(projectId)) {
      onDevelop()
      return
    }
    setJoinedIds((current) => new Set(current).add(projectId))
  }

  return (
    <section className="page page--stars" aria-labelledby="stars-title">
      <h1 className="sr-only" id="stars-title">Stars 项目地图</h1>
      <div className="galaxy-toolbar">
        <div className="category-filter" aria-label="项目类型">
          {categoryOptions.map((item) => <button type="button" className={category === item ? 'active' : ''} onClick={() => selectCategory(item)} key={item}>{item !== '全部' && <i className={`category-dot category-dot--${categoryClass[item]}`} />}{item}</button>)}
        </div>
        <div className="galaxy-selectors">
          <label><span>星数</span><select aria-label="Stars 筛选" value={starFloor} onChange={(event) => { setStarFloor(Number(event.target.value)); resetSelection() }}><option value={0}>全部</option><option value={90}>90★+</option><option value={140}>140★+</option><option value={180}>180★+</option></select></label>
          <label><span>规模</span><select aria-label="项目规模" value={scale} onChange={(event) => { setScale(event.target.value as 'all' | ProjectScale); resetSelection() }}><option value="all">全部</option><option value="small">小型</option><option value="medium">中型</option><option value="large">大型</option></select></label>
        </div>
      </div>

      <div
        className={`project-galaxy${isDragging ? ' is-dragging' : ''}`}
        ref={mapRef}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('.project-planet, .project-focus, .map-controls')) resetSelection() }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="galaxy-copy"><strong>{visibleProjects.length}</strong><span>个项目 · 项目星图</span></div>
        <div className="map-hint">拖动画布 · 滚轮缩放 · 点击项目查看详情</div>
        <div className="map-controls" aria-label="地图缩放">
          <button type="button" aria-label="缩小项目地图" onClick={() => zoomAtCenter(.84)}>−</button>
          <span>{Math.round(mapView.scale * 100)}%</span>
          <button type="button" aria-label="放大项目地图" onClick={() => zoomAtCenter(1.18)}>+</button>
          <button type="button" className="map-reset" onClick={fitMap}>适应</button>
        </div>

        <div className={`map-world map-world--${zoomLevel}`} style={{ width: MAP_WIDTH, height: MAP_HEIGHT, transform: `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.scale})` }}>
          <div className="map-dust" aria-hidden="true">
            {mapDust.map((point, index) => <i style={{ left: point.x, top: point.y, width: point.size, height: point.size, opacity: point.opacity }} key={index} />)}
          </div>
          {(categoryOptions.slice(1) as ProjectCategory[]).map((zoneCategory) => {
            const zone = categoryZones[zoneCategory]
            const zoneStyle = { '--zone-x': `${zone.x}px`, '--zone-y': `${zone.y}px`, '--zone-width': `${zone.width}px`, '--zone-height': `${zone.height}px` } as CSSProperties
            return <div className={`cluster-zone cluster-zone--${categoryClass[zoneCategory]}${category !== '全部' && category !== zoneCategory ? ' muted' : ''}`} style={zoneStyle} key={zoneCategory}><span><i />{zoneCategory}<small>{projectCatalog[zoneCategory].length} 个项目</small></span></div>
          })}

          <div className="project-relations" aria-hidden="true">
            {projectRelations.map((relation) => {
              if (!visibleProjectIds.has(relation.from) || !visibleProjectIds.has(relation.to)) return null
              const style = relationStyle(relation.from, relation.to)
              if (!style) return null
              return <span className="project-relation" style={style} key={`${relation.from}-${relation.to}`}><i>{relation.label}</i></span>
            })}
          </div>

          {visibleProjects.map((project) => {
            const totalPotential = project.baseStars + project.impactStars
            const style = { '--orbit-x': `${project.position.x}px`, '--orbit-y': `${project.position.y}px` } as CSSProperties
            return (
              <div className={`orbit-node orbit-node--${project.scale}`} style={style} key={project.id}>
                <button
                  type="button"
                  className={`project-planet project-planet--${categoryClass[project.category]}${selectedId === project.id ? ' selected' : ''}`}
                  aria-label={`${project.name}，${project.category}，潜在 ${totalPotential} Stars，已参与 ${project.people} 人，还有 ${project.openSlots} 个空位`}
                  aria-pressed={selectedId === project.id}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(project.id) }}
                >
                  <span className="planet-category">{project.category} · {project.scale === 'large' ? '大型' : project.scale === 'medium' ? '中型' : '小型'}</span>
                  <strong>{project.name}</strong>
                  <span className="planet-stars">{totalPotential} ★</span>
                  <span className="planet-members"><MemberFigures people={project.people} openSlots={project.openSlots} /><b>{project.people} 人 · {project.openSlots} 空位</b></span>
                </button>
              </div>
            )
          })}
        </div>

        {visibleProjects.length === 0 && <div className="galaxy-empty"><strong>没有符合条件的项目</strong><span>降低筛选条件后会重新出现</span></div>}
        <div className="galaxy-legend"><span><i className="legend-size" />圆圈大小 = 项目规模</span><span><i className="legend-filled" />实心 = 已参与</span><span><i className="legend-open" />空心 = 可加入</span></div>

        {selectedProject && visibleProjects.some((project) => project.id === selectedProject.id) && (
          <aside className={`project-focus project-focus--${categoryClass[selectedProject.category]}`} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="focus-close" aria-label="关闭项目详情" onClick={resetSelection}>×</button>
            <span className="focus-type">{selectedProject.category} · {selectedProject.automation}</span>
            <h2>{selectedProject.name}</h2>
            <p>{selectedProject.summary}</p>
            <div className="focus-stats">
              <div><span>基础</span><strong>{selectedProject.baseStars} ★</strong></div>
              <div><span>影响上限</span><strong>+{selectedProject.impactStars} ★</strong></div>
              <div><span>共创席位</span><strong>{selectedProject.people} + {selectedProject.openSlots}</strong></div>
            </div>
            <div className="focus-members"><MemberFigures people={selectedProject.people} openSlots={selectedProject.openSlots} /><span>{selectedProject.people} 人参与 · {selectedProject.openSlots} 个空位</span></div>
            <div className="focus-footer"><span>{selectedProject.openings}</span><button type="button" onClick={() => joinSelected(selectedProject.id)}>{joinedIds.has(selectedProject.id) ? '进入开发' : '申请加入'}</button></div>
          </aside>
        )}
      </div>
    </section>
  )
}

const agentMeta: Record<AgentId, { name: string; human: string; remit: string; step: string }> = {
  business: { name: '业务 Agent', human: '业务人员', remit: '方案、证据、补件', step: '02' },
  supervisor: { name: '监督 Agent', human: '领导 + 领导 Agent', remit: '目标拆解、受控委派', step: '01' },
  risk: { name: '风控 Agent', human: '风控人员', remit: '独立质询、最终裁决', step: '03' },
}

const statusText: Record<string, string> = {
  TASK_STATE_SUBMITTED: '待运行',
  TASK_STATE_WORKING: '处理中',
  TASK_STATE_INPUT_REQUIRED: '等待输入',
  TASK_STATE_COMPLETED: '已完成',
  TASK_STATE_REJECTED: '已否决',
  TASK_STATE_CANCELED: '已取消',
  TASK_STATE_FAILED: '失败',
}

function AgentPanel({ agentId, context }: { agentId: AgentId; context: CoordinationContext }) {
  const meta = agentMeta[agentId]
  const task = [...context.tasks].reverse().find((item) => item.agentId === agentId)
  return (
    <article className={`governance-agent governance-agent--${agentId}`}>
      <header><span>{meta.step}</span><div><strong>{meta.name}</strong><small>{meta.human}</small></div></header>
      <p>{meta.remit}</p>
      {task ? <div className="agent-task"><span className={`task-state task-state--${task.status.state.toLowerCase()}`}>{statusText[task.status.state] ?? task.status.state}</span><strong>{task.summary}</strong><small>{task.artifacts.length} 个 Artifact · A2A Task</small></div> : <div className="agent-task agent-task--empty">等待监督 Agent 分派</div>}
    </article>
  )
}

function DevelopmentPage() {
  const [contexts, setContexts] = useState<CoordinationContext[]>([])
  const [active, setActive] = useState<CoordinationContext | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [goal, setGoal] = useState('让设备融资首轮审查形成证据完整、责任清晰、可执行的风险结论')
  const [successMetric, setSuccessMetric] = useState('硬门槛全部有证据，所有质询关闭，最终裁决可追溯')
  const [minimumYield, setMinimumYield] = useState(82)
  const [evidenceTitle, setEvidenceTitle] = useState('')
  const [evidenceSource, setEvidenceSource] = useState('业务材料')
  const [evidenceLocator, setEvidenceLocator] = useState('')
  const [decisionNote, setDecisionNote] = useState('基于本轮证据与质询结论作出裁决。')

  function acceptContext(context: CoordinationContext) {
    setActive(context)
    setContexts((current) => [context, ...current.filter((item) => item.id !== context.id)])
  }

  useEffect(() => {
    listContexts()
      .then((items) => {
        setContexts(items)
        setActive(items[0] ?? null)
        setConnection('live')
      })
      .catch((reason: unknown) => {
        setConnection('offline')
        setError(reason instanceof Error ? reason.message : '后端连接失败')
      })
    const events = new EventSource('/api/events')
    events.addEventListener('ready', () => setConnection('live'))
    events.addEventListener('context', (event) => {
      const context = JSON.parse((event as MessageEvent<string>).data) as CoordinationContext
      setContexts((current) => [context, ...current.filter((item) => item.id !== context.id)])
      setActive((current) => current?.id === context.id ? context : current)
    })
    events.onerror = () => setConnection('offline')
    return () => events.close()
  }, [])

  async function perform(action: () => Promise<CoordinationContext>) {
    setBusy(true)
    setError('')
    try {
      acceptContext(await action())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function startGoal(event: FormEvent) {
    event.preventDefault()
    void perform(async () => {
      const created = await createContext({
        goal,
        successMetric,
        minimumYield,
        constraints: ['风控否决不可被领导或监督 Agent 覆盖', '证据必须保留来源与定位'],
        evidence: [{ title: '融资租赁合同', source: '业务材料', locator: '合同第 4 页' }],
      })
      return runRound(created.id)
    })
  }

  function submitEvidence(event: FormEvent) {
    event.preventDefault()
    if (!active || !evidenceTitle.trim()) return
    void perform(async () => {
      const supplemented = await addEvidence(active.id, { title: evidenceTitle, source: evidenceSource, locator: evidenceLocator })
      setEvidenceTitle('')
      setEvidenceLocator('')
      return runRound(supplemented.id)
    })
  }

  function decide(outcome: RiskOutcome) {
    if (!active) return
    void perform(() => recordRiskDecision(active.id, { outcome, note: decisionNote }))
  }

  function reconsider() {
    if (!active) return
    void perform(async () => runRound((await reconsiderContext(active.id, decisionNote)).id))
  }

  const canDecide = active && active.phase === '等待风控裁决' && active.yield.openChallenges.length === 0
  const canReject = active && active.round > 0 && !active.finalDecision

  return (
    <section className="page page--development a2a-page" aria-labelledby="development-title">
      <header className="a2a-titlebar">
        <div><span className="eyebrow">A2A 1.0 · GOVERNANCE EXTENSION</span><h1 id="development-title">三 Agent 目标协作</h1><p>监督者编排，业务交付证据，风控独立裁决。共同 yield 不能覆盖风险否决。</p></div>
        <div className="a2a-title-actions"><span className={`connection-state connection-state--${connection}`}><i />{connection === 'live' ? '后端已连接' : connection === 'connecting' ? '正在连接' : '后端断开'}</span>{contexts.length > 0 && <select aria-label="选择协作目标" value={active?.id ?? ''} onChange={(event) => setActive(contexts.find((item) => item.id === event.target.value) ?? null)}><option value="">新目标</option>{contexts.map((item) => <option value={item.id} key={item.id}>{item.goal.slice(0, 22)}</option>)}</select>}</div>
      </header>

      {!active ? (
        <form className="goal-setup" onSubmit={startGoal}>
          <span className="setup-kicker">从一个可验收目标开始</span>
          <label>共同目标<textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} /></label>
          <label>成功指标<input value={successMetric} onChange={(event) => setSuccessMetric(event.target.value)} /></label>
          <label>最低收敛门槛 <strong>{minimumYield}</strong><input type="range" min="50" max="100" value={minimumYield} onChange={(event) => setMinimumYield(Number(event.target.value))} /></label>
          <button type="submit" disabled={busy || connection === 'offline'}>{busy ? '启动中…' : '启动三 Agent'}</button>
          <small>本地 P0 使用确定性策略 Agent；未接入模型 API，也不执行真实融资审批。</small>
        </form>
      ) : (
        <div className="a2a-workbench">
          <section className="goal-contract">
            <div className="goal-copy"><span>共同目标 · Revision {active.revision} · Context {active.id.slice(-8)}</span><h2>{active.goal}</h2><p>{active.successMetric}</p><div>{active.constraints.map((item) => <small key={item}>硬约束 · {item}</small>)}</div></div>
            <div className="yield-meter" style={{ '--yield': `${active.yield.score * 3.6}deg` } as CSSProperties}><span><strong>{active.yield.score}</strong><small>/ {active.minimumYield}</small></span><p>{active.yield.achieved ? '已收敛' : active.phase}</p></div>
            <div className="goal-gate"><span>当前 Gate</span><strong>{active.phase}</strong><small>第 {active.round} 轮 · {statusText[active.status] ?? active.status}</small>{active.status !== 'TASK_STATE_COMPLETED' && active.status !== 'TASK_STATE_REJECTED' && <button type="button" onClick={() => void perform(() => runRound(active.id))} disabled={busy}>重新运行本轮</button>}</div>
          </section>

          <section className="agent-lane" aria-label="三 Agent 责任单元">
            <AgentPanel agentId="business" context={active} />
            <AgentPanel agentId="supervisor" context={active} />
            <AgentPanel agentId="risk" context={active} />
          </section>

          <div className="governance-grid">
            <section className="evidence-panel">
              <header><div><span>BUSINESS ARTIFACTS</span><h2>证据清单</h2></div><strong>{active.evidence.length} 项</strong></header>
              <div className="evidence-list">{active.evidence.map((item) => <article key={item.id}><i>✓</i><div><strong>{item.title}</strong><span>{item.source}</span></div><small>{item.locator}</small></article>)}</div>
              {active.status !== 'TASK_STATE_COMPLETED' && <form className="evidence-form" onSubmit={submitEvidence}><input aria-label="证据标题" placeholder="补充证据名称" value={evidenceTitle} onChange={(event) => setEvidenceTitle(event.target.value)} /><input aria-label="证据来源" placeholder="来源" value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value)} /><input aria-label="证据定位" placeholder="页码 / 字段 / 记录号" value={evidenceLocator} onChange={(event) => setEvidenceLocator(event.target.value)} /><button type="submit" disabled={busy || !evidenceTitle.trim()}>补证并复核</button></form>}
            </section>

            <section className="risk-panel">
              <header><div><span>RISK GATE</span><h2>质询与裁决</h2></div><strong>{active.yield.openChallenges.length === 0 ? '门槛已满足' : `${active.yield.openChallenges.length} 项未关闭`}</strong></header>
              <div className="challenge-list">{active.yield.openChallenges.length > 0 ? active.yield.openChallenges.map((item) => <p key={item}><i>!</i>{item}</p>) : <p className="challenge-clear"><i>✓</i>{active.finalDecision ? `本 revision 已完成风控裁决：${active.phase}。` : '机器收敛条件已满足，等待风控人员最终裁决。'}</p>}</div>
              <label className="decision-note">风控理由<textarea rows={3} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} disabled={!canDecide} /></label>
              <div className="decision-actions"><button type="button" onClick={() => decide('approved')} disabled={!canDecide || busy}>通过</button><button type="button" onClick={() => decide('conditionally_approved')} disabled={!canDecide || busy}>附条件通过</button><button type="button" className="reject" onClick={() => decide('rejected')} disabled={!canReject || busy}>否决</button></div>
              {active.finalDecision && <div className={`final-decision final-decision--${active.finalDecision.outcome}`}><strong>{active.finalDecision.outcome === 'approved' ? '已通过' : active.finalDecision.outcome === 'conditionally_approved' ? '附条件通过' : '已否决'}</strong><p>{active.finalDecision.note}</p><small>风控人员 · 不可变记录</small>{active.finalDecision.outcome === 'rejected' && <button type="button" onClick={reconsider} disabled={busy}>基于新材料发起 Revision {active.revision + 1}</button>}</div>}
            </section>
          </div>

          <section className="audit-strip"><header><div><span>AUDIT HASH CHAIN</span><h2>事件审计</h2></div><small>{active.audit.length} 条 · 原始意见与证据不覆盖</small></header><div>{[...active.audit].reverse().slice(0, 6).map((event) => <article key={event.eventId}><span>{String(event.sequence).padStart(2, '0')}</span><div><strong>{event.action}</strong><p>{event.detail}</p></div><code>{event.hash.slice(0, 10)}</code></article>)}</div></section>
        </div>
      )}
      {error && <div className="a2a-error" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
    </section>
  )
}

function ProfilePage() {
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [direction, setDirection] = useState<SortDirection>('desc')
  const [selectedId, setSelectedId] = useState(auditProjects[0].id)

  const sortedProjects = useMemo(() => [...auditProjects].sort((a, b) => {
    const values = { time: [new Date(a.updatedAt).getTime(), new Date(b.updatedAt).getTime()], stars: [a.baseStars + a.impactStars, b.baseStars + b.impactStars], progress: [a.progress, b.progress] }[sortKey]
    return direction === 'desc' ? values[1] - values[0] : values[0] - values[1]
  }), [sortKey, direction])
  const selectedProject = auditProjects.find((project) => project.id === selectedId) ?? auditProjects[0]

  return (
    <section className="page page--profile" aria-labelledby="profile-title">
      <h1 className="sr-only" id="profile-title">个人与审计</h1>
      <aside className="star-overview" aria-label="Stars 概览">
        <div className="overview-intro"><span>MY STARS</span><strong>3,860 <small>★</small></strong><p>约 ¥3,860,000</p></div>
        <article className="star-stat star-stat--total"><span>累计获得</span><strong>3,860</strong><small>已确认贡献</small></article>
        <article className="star-stat star-stat--year"><span>本年获得</span><strong>2,240</strong><small>同比 +28%</small></article>
        <article className="star-stat star-stat--pending"><span>验证中</span><strong>680</strong><small>4 个季度批次</small></article>
        <div className="source-mix"><header><span>来源构成</span><small>本年</small></header><div><i /><i /><i /><i /></div><p><span>项目 52%</span><span>影响 28%</span><span>复用 13%</span><span>维护 7%</span></p></div>
      </aside>

      <main className="audit-center">
        <div className="audit-toolbar"><div><span className="eyebrow">CONTRIBUTION</span><h2>审计与释放</h2></div><div><select aria-label="排序字段" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="time">按时间</option><option value="stars">按星数</option><option value="progress">按进度</option></select><button type="button" onClick={() => setDirection((current) => current === 'desc' ? 'asc' : 'desc')} aria-label="切换排序方向">{direction === 'desc' ? '↓' : '↑'}</button></div></div>
        <section className="release-forecast" aria-label="季度释放预测"><div><span>季度释放预测</span><strong>下一批 18 ★ · 10 月 01 日</strong></div><div className="forecast-bars">{[34, 58, 44, 72, 56, 86].map((height, index) => <span style={{ '--bar-height': `${height}%` } as CSSProperties} key={height + index}><i /><small>{['Q3', 'Q4', 'Q1', 'Q2', 'Q3', 'Q4'][index]}</small></span>)}</div></section>
        <div className="audit-projects">
          {sortedProjects.map((project) => {
            const reachedStage = Math.round(project.progress / 25)
            return <button type="button" className={`audit-record${selectedId === project.id ? ' selected' : ''}`} onClick={() => setSelectedId(project.id)} key={project.id}>
              <div className="audit-project-name"><span className={`type-dot type-dot--${categoryClass[project.category]}`} /><div><h3>{project.name}</h3><p>{project.stage} · {project.updatedLabel}</p></div></div>
              <div className="audit-value"><strong>{project.releasedStars} ★</strong><span>基础 {project.baseStars} · 影响 +{project.impactStars}</span></div>
              <div className="audit-flow"><span className="audit-line"><i style={{ width: `${project.progress}%` }} /></span><div className="audit-points">{auditStages.map((stage, index) => <span className={index <= reachedStage ? 'reached' : ''} key={stage}><i />{stage}</span>)}</div></div>
              <div className="quarter-flow"><span>价值验证</span><div>{[1, 2, 3, 4].map((quarter) => <i className={quarter <= project.verificationQuarter ? 'reached' : ''} key={quarter}>Q{quarter}</i>)}</div></div>
            </button>
          })}
        </div>
      </main>

      <aside className="settlement-detail">
        <div className="person-card"><span className="person-avatar">周</span><div><strong>周明</strong><p>项目共创者 · 开发方</p></div><button type="button" aria-label="个人设置">···</button></div>
        <div className="detail-status"><span>当前项目</span><strong>{selectedProject.name}</strong><small>{selectedProject.stage} · 审计进度 {selectedProject.progress}%</small></div>
        <div className="detail-ring" style={{ '--progress': `${selectedProject.progress * 3.6}deg` } as CSSProperties}><span><strong>{selectedProject.progress}%</strong><small>审计</small></span></div>
        <dl><div><dt>已释放</dt><dd>{selectedProject.releasedStars} ★</dd></div><div><dt>影响上限</dt><dd>+{selectedProject.impactStars} ★</dd></div><div><dt>下一结算</dt><dd>{selectedProject.nextRelease}</dd></div></dl>
        <div className="detail-evidence"><span>价值依据</span><strong>{selectedProject.impactMetric}</strong><p>{selectedProject.evidence}</p></div>
        <button type="button" className="detail-action">查看完整证据</button>
        <small className="star-rate">1 ★ = ¥1,000 · 不可转让</small>
      </aside>
    </section>
  )
}

function App() {
  const [view, setView] = useState<ViewId>('development')
  return (
    <div className={`app-shell app-shell--${view}`}>
      <header className="app-header">
        <nav className="top-nav" aria-label="主导航">
          {navItems.map((item) => <button className={view === item.id ? 'active' : ''} type="button" aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)} key={item.id}><NavigationIcon id={item.id} /></button>)}
        </nav>
      </header>
      {view === 'stars' && <StarsPage onDevelop={() => setView('development')} />}
      {view === 'development' && <DevelopmentPage />}
      {view === 'profile' && <ProfilePage />}
    </div>
  )
}

export default App
