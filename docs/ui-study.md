# UI study for ShipBridge (2026-11-12, Asia/Shanghai)

Goal: stop ShipBridge from reading as "AI-generated". The notes below come from pages actually fetched or found via search this session; nothing is invented.

## Sources

### GitHub / web (anti-"AI look")
- iamneilroberts/claude-skills, `unslop-ui` — ranked tells from user comments: default shadcn/Tailwind look, AI purple, gradients, too much motion, pill/round everything, emoji icons, generic fonts, centered hero + 3 cards. "A tell is just a default that nobody overrode." https://github.com/iamneilroberts/claude-skills/blob/main/skills/unslop-ui/SKILL.md
- funboy322/avoid-ai-design — catalog incl. second-order defaults (cream+terracotta, black+acid green, all-caps mono chrome, 01/02/03 numbering), `rounded-2xl shadow-lg` everywhere, icon-in-rounded-square, count-up stats, worn Lucide + sparkle. Method: derive direction from the product's own materials/artifacts and pick ONE signature detail. https://github.com/funboy322/avoid-ai-design
- qodesign "Make UI not look AI-generated: a v0 checklist" — own tokens for primary/background/radius; two typefaces with different jobs; one or two interactions with real feedback; copy that names product and user. https://qodesign.dev/blog/make-v0-app-not-look-ai-generated
- freedesignmd "The shadcn trap" — add one token the kit doesn't ship (signature shadow / easing / border treatment) to give the project a fingerprint. https://freedesignmd.com/blog/shadcn-looks-generic
- Design for AI, anti-slop principles — real type scale, restrained palette, depth from hairline borders + inset highlight not heavy shadows, motion explains state (200–700ms ease-out, press 0.97), do all states (hover/focus/disabled/loading/empty/error), tabular numbers. https://design.yaps.ai/zh-hans/docs/principles
- Refactoring UI notes: LovroPodobnik/refactoring-ui-skill (spacing 4/8/12/16/24/32/48/64, type 12/14/16/18/20/24/30/36, defined shades), tigerabrodi/refactoring-ui-notes (hierarchy by weight+color, one primary action, de-emphasize competitors, labels last resort), Dennis O'Keeffe notes (don't use gray text on colored bg; greys can be tinted). https://github.com/LovroPodobnik/refactoring-ui-skill · https://github.com/tigerabrodi/refactoring-ui-notes · https://docs.dennisokeeffe.com/ui/refactoring-ui/principles
- Tremor dashboard template (Apache-2.0) as a reference for a dense, neutral Next.js dashboard. https://github.com/tremorlabs/template-dashboard-oss

### Chinese / Bilibili
- Bilibili 【Impeccable】33.3k⭐ 设计 Skill — AI 前端的"圆角卡片 + 紫蓝渐变 + Inter"模板脸，如何系统性去 AI 味（官网 impeccable.style）。https://www.bilibili.com/video/BV128Vy6qEWe/
- Bilibili 鱼皮《AI 做的网站丑爆了？7 招教你去除 AI 味儿》— 规则文件 / 组件库 / 参考设计驱动。https://www.bilibili.com/video/BV1QF6EBiErM/
- Bilibili《中后台管理系统 交互设计 通用组件库 v2.0》— 系统框架、按钮、表格、关键指标、消息提示、流程节点等中后台标准组件（29 集）。https://www.bilibili.com/video/BV11G4y1T7NM/
- 一个机场的博客：Addy Osmani 总结的 8 大 AI 味陷阱（满屏蓝紫、滥用渐变、万物大圆角、模板首屏、占位文本、超大内边距、千篇一律卡片网格、过度阴影）。https://blog.ygjc.cc/posts/frontend-ui-design-avoid-ai-flavor-8-patterns
- Codex Design：12 个破绽 + "第二波 AI 套路"（标题上方小标签、编号区块、到处细线、每区块淡入）。https://codexdesign.io/zh/guides/ai-ui-design-tells
- 优设网《做 B 端后台产品…设计流程和规范》— 1440×900 设计尺寸；左右栏布局；8px 基准、小组件 4px；表格行高 36/40/48；文字左对齐、数字右对齐、金额小数点对齐；可复制的编码前加复制图标。https://www.uisdc.com/business-product-design
- 优设网《掌握表格设计，就掌握 B 端设计的半壁江山》— 表头通过底色/分割线/字重区分；固定首列和操作列（≤3 个固定元素）；单元格交互：点击复制、悬浮提示。https://www.uisdc.com/b-end-form-design-4
- 优设网 58UXD《CRM 表格减负提效》— 12px 基础字号 + 14px 强调；28px mini 控件；hover 行高亮；空值显示"-"；行高 44px。https://www.uisdc.com/crm-table-design
- MOMOUX《B 端数据可视化大屏设计》— L1 核心指标 ≤5 个放左上；动效只为"数据变化/引导注意"，数字变化 0.6–0.8s。https://www.momoux.com/ux/momoux4958.html

### uiverse.io (all MIT; snippets saved in docs/uiverse/)
Browsed buttons, checkboxes, loaders, switches, inputs, tooltips (~150 elements; filtered out ones with gradients/neon/glow/blur). Picked for a fintech ops tool:
1. Checkbox — Galahhad "sweet-ape-100": antd-like 1677ff checkbox with a scaled checkmark + ripple on check. https://uiverse.io/Galahhad/sweet-ape-100
2. Button — ErzenXz "slimy-chicken-63": plain bordered button with a quiet hover; base for secondary buttons. https://uiverse.io/ErzenXz/slimy-chicken-63
3. Button — TCdesign-dev "silent-sheep-31": solid blue primary with press feedback (tone its glow down to a 1px inset highlight). https://uiverse.io/TCdesign-dev/silent-sheep-31
4. Loader — cosnametv "spotty-starfish-76": neutral grey blocks shuffling — reads like parcels being sorted; fits "matching". https://uiverse.io/cosnametv/spotty-starfish-76
5. Switch — Praashoo7 "angry-starfish-78": compact switch, base for the EN/中文 toggle or a "notify buyer" setting. https://uiverse.io/Praashoo7/angry-starfish-78
6. Input — Galahhad "average-snail-50": input with shake-on-invalid; for the manifest/order search field. https://uiverse.io/Galahhad/average-snail-50

## Rules for ShipBridge (distilled)
1. Direction from the product's material: shipping labels, waybills, carrier scans, PayPal ledger. Signature detail: a "waybill" treatment — tracking numbers in a monospace-ish tabular face inside a faint dashed-border chip, like a printed label. Use it consistently, nowhere else.
2. Palette: cool neutral greys tinted slightly blue (not pure slate defaults); one accent PayPal blue (#0070E0 interactive, #003087 strong text/brand); semantic green/amber/red only for status. No gradients. Every text color passes AA.
3. Type: body 14px, table 13px, labels 12px, KPI numbers 24–28px, page title 20px. Pair: Inter (or system UI) for UI + a tabular/mono face (e.g. "JetBrains Mono"/ui-monospace) only for tracking numbers & IDs. CJK stack: PingFang SC / Noto Sans SC, line-height 1.6 in 中文.
4. Spacing scale 4/8/12/16/24/32 only; more space between groups than within. Controls 32px (toolbar) / 28px (in-table). Table rows 36–40px.
5. Hierarchy by weight and color before size; exactly one primary button per view; secondary = bordered; tertiary = text.
6. Radius scale: 4px (chips, inputs, buttons), 6px (panels), 999 only for status dots. No rounded-2xl.
7. Depth: 1px borders + an inset 1px top highlight on primary buttons; one soft shadow only for floating layers (drawer, toast, menu).
8. KPIs: ≤4, top-left, label above number, delta in small text; numbers tabular, right aligned in tables; money with 2 decimals aligned.
9. Motion explains state only: count transition 600–800ms on KPI change, button press scale 0.97, checkbox check animation, drawer slide 200ms ease-out, row "verified" flash once. Respect prefers-reduced-motion.
10. All states: hover row highlight, focus-visible rings, disabled, loading (sorting-parcels loader + skeleton rows), empty, error; empty cells show "–".
11. Icons: one set (lucide), 16px, stroke 1.75, never in colored rounded squares; no sparkles, no emoji.
12. Copy: terse, operational, specific numbers and carrier names; no "unlock/seamless/powerful". Avoid uppercase eyebrow labels above every heading and 01/02/03 numbering (second-wave tells).
13. Tables (B端): text left, numbers right; tracking/order IDs with copy-on-click; fixed header; first column + action column pinned; hover tooltip for truncated or mismatched cells.
14. Logo: a simple mark (a parcel/arrow bridge glyph) in solid #003087, wordmark in semibold; not a letter in a gradient square.
15. Review loop: screenshot, silhouette test (could it be anyone's?), fix the top tells, re-shoot.
