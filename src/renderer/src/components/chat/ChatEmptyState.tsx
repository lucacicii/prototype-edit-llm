import React from 'react'
import { Globe, LayoutDashboard, Smartphone, BarChart3, Sparkles } from 'lucide-react'
import type { ProductScenario } from '../../stores/usePrototypeStore'

interface QuickStarter {
  title: string
  description: string
  icon: React.ReactNode
  prompt: string
}

function startersFor(scenario?: ProductScenario): QuickStarter[] {
  switch (scenario) {
    case 'website':
      return [
        {
          title: '品牌官网首页',
          description: 'Hero 大标题 + 特性矩阵 + 价格表 + 页脚的完整官网',
          icon: <Globe size={14} />,
          prompt: '为我的产品生成一个品牌官网首页：包含 Hero 区（大标题、副标题、CTA 按钮）、产品特性矩阵（3-6 个卡片）、价格表（三档）与页脚。风格：现代 SaaS，明亮商务。'
        },
        {
          title: '营销落地页',
          description: '活动宣传页，含倒计时、用户证言与转化动线',
          icon: <Sparkles size={14} />,
          prompt: '生成一个营销活动落地页：顶部活动横幅与倒计时、核心卖点区、客户证言（头像+引述）、常见问题折叠，最后是留资表单。'
        },
        {
          title: '深色科技风官网',
          description: '深色背景 + 渐变高光的科技品牌调性',
          icon: <Globe size={14} />,
          prompt: '生成一个深色科技风的品牌官网首页，使用渐变高光、玻璃拟态卡片，包含 Hero、产品能力、数据指标展示和页脚。'
        },
        {
          title: '多页官网结构',
          description: '首页 + 功能页 + 关于我们 的多页面导航',
          icon: <LayoutDashboard size={14} />,
          prompt: '生成一个带顶部导航的多页面官网原型：首页、产品功能页、关于我们，导航可在页面间切换。'
        }
      ]
    case 'admin':
      return [
        {
          title: '列表 + 筛选工作台',
          description: '多条件筛选表格 + 分页 + 批量操作',
          icon: <LayoutDashboard size={14} />,
          prompt: '生成一个中后台管理页面：顶部统计卡片（4 个指标），下面是多条件筛选（状态/日期/关键词）的数据表格，带分页与批量操作按钮。'
        },
        {
          title: '表单新建流程',
          description: '抽屉式新建表单 + 校验 + 提交反馈',
          icon: <Sparkles size={14} />,
          prompt: '生成一个「新建订单」的中后台页面：左侧主列表 + 右侧抽屉表单（基础信息、商品明细可增删行、备注），带表单校验和提交成功反馈。'
        },
        {
          title: '状态审批流',
          description: '待办列表 + 详情页 + 审批操作',
          icon: <LayoutDashboard size={14} />,
          prompt: '生成一个审批工作台：待办审批列表（状态标签），点击进入详情页展示申请信息与时间线，底部通过/驳回操作。'
        },
        {
          title: '数据概览仪表盘',
          description: '指标卡 + 趋势图 + 排行榜',
          icon: <BarChart3 size={14} />,
          prompt: '生成一个运营数据概览页：顶部 4 个指标卡（环比箭头），中部折线趋势图与环形占比图，底部销售排行榜表格。'
        }
      ]
    case 'mobile':
      return [
        {
          title: 'App 首页信息流',
          description: '底部 TabBar + 卡片信息流 + 下拉刷新感',
          icon: <Smartphone size={14} />,
          prompt: '生成一个移动端 App 首页原型（竖屏手机壳内预览）：顶部搜索栏、轮播 Banner、分类金刚区、商品卡片瀑布流，底部 5 个 Tab 导航。'
        },
        {
          title: '电商购物流程',
          description: '首页 → 详情 → 购物车 → 结算 的核心链路',
          icon: <Smartphone size={14} />,
          prompt: '生成移动端电商核心流程原型：商品详情页（轮播图、规格选择弹层、底部购买栏）和购物车页（商品勾选、金额汇总、结算按钮）。'
        },
        {
          title: '个人中心',
          description: '用户信息头部 + 订单入口 + 设置列表',
          icon: <Sparkles size={14} />,
          prompt: '生成一个移动端个人中心页：顶部用户头像与昵称、资产区（余额/积分/优惠券）、我的订单入口（四态）、常用功能列表。'
        },
        {
          title: '登录注册页',
          description: '验证码登录 + 协议勾选 的移动端表单',
          icon: <Smartphone size={14} />,
          prompt: '生成移动端登录页：手机号输入、验证码输入与获取按钮（60s 倒计时）、协议勾选，以及微信/Apple 登录按钮。'
        }
      ]
    case 'dashboard':
      return [
        {
          title: '深色监控大屏',
          description: '指标卡 + 实时趋势 + 告警列表',
          icon: <BarChart3 size={14} />,
          prompt: '生成一个深色数据监控大屏：顶部标题与时间，左右两侧指标卡与环形图，中间大折线趋势图，底部滚动告警列表。'
        },
        {
          title: '经营分析看板',
          description: '多维度筛选 + 图表组合 + 明细表',
          icon: <BarChart3 size={14} />,
          prompt: '生成一个浅色经营分析看板：顶部日期与维度筛选，GMV/订单量/客单价指标卡，渠道占比环形图，区域柱状排行与明细表。'
        },
        {
          title: '实时数据滚动',
          description: '数字翻牌 + 滚动明细的指挥屏风格',
          icon: <Sparkles size={14} />,
          prompt: '生成一个指挥中心风格大屏：核心指标数字翻牌动效、地图占位、右侧实时滚动的事件流水。'
        },
        {
          title: '设备状态监控',
          description: '设备在线率 + 状态分布 + 告警趋势',
          icon: <LayoutDashboard size={14} />,
          prompt: '生成一个 IoT 设备监控看板：在线/离线/故障状态分布、设备类型占比、告警趋势折线与设备列表。'
        }
      ]
    default:
      return [
        {
          title: '做一个官网',
          description: '品牌宣传 / 落地页，重视觉表现',
          icon: <Globe size={14} />,
          prompt: '帮我做一个品牌官网原型，先问我几个关键问题再开始。'
        },
        {
          title: '做一个中后台',
          description: '表格 / 表单 / 审批流的 B 端系统',
          icon: <LayoutDashboard size={14} />,
          prompt: '帮我做一个中后台管理系统原型，先和我确认核心管理对象和流程。'
        },
        {
          title: '做一个手机端页面',
          description: 'H5 / 小程序风格的移动端原型',
          icon: <Smartphone size={14} />,
          prompt: '帮我做一个移动端 H5 原型，先问我目标用户和核心场景。'
        },
        {
          title: '做一个数据大屏',
          description: '指标卡 + 图表 + 实时感的可视化看板',
          icon: <BarChart3 size={14} />,
          prompt: '帮我做一个数据可视化大屏原型，先确认核心指标和图表类型。'
        }
      ]
  }
}

export function ChatEmptyState({
  scenario,
  projectName,
  onSelectPrompt
}: {
  scenario?: ProductScenario
  projectName?: string
  onSelectPrompt: (prompt: string) => void
}) {
  const starters = startersFor(scenario)
  return (
    <div className="pc-empty">
      <div className="pc-empty-hero">
        <div className="pc-empty-badge">
          <Sparkles size={24} />
        </div>
        <h2 className="pc-empty-title">{projectName || 'AI 原型工作台'}</h2>
        <p className="pc-empty-subtitle">
          描述你想做的产品，AI 顾问会先与你确认关键细节，再自动选定技术栈并生成完整原型。
        </p>
      </div>
      <div className="pc-empty-grid">
        {starters.map((starter) => (
          <button
            key={starter.title}
            type="button"
            className="pc-starter"
            onClick={() => onSelectPrompt(starter.prompt)}
          >
            <div className="pc-starter-icon">{starter.icon}</div>
            <div className="pc-starter-text">
              <div className="pc-starter-title">{starter.title}</div>
              <div className="pc-starter-desc">{starter.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
