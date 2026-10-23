# dsh-linked-projects

给 DeepSeek Harness 的一个会话关联**多个项目目录**，并让模型知道这件事。

一个会话默认只认一个 workspace。但很多真实工程是拆成多个仓库的：前台一个、后台一个、公共库一个，同一个需求经常要跨两三个仓库改。这个插件把"本会话关心哪几个项目"变成会话级的显式状态：

- **底部项目 chip**：勾选本会话要关联的项目，一键把工作目录切到其中任意一个；
- **`@project` 提及**：在输入框敲 `@`，候选项里出现 `project:<标识>`，选中即关联该项目，并把 mention 展开成 `目录名(绝对路径)` 留在提示词里；
- **上下文注入**：被关联的项目以一份纯清单进入模型上下文（名称、标识、简介、绝对路径），不写"必须协同"之类的祈使句；
- **插件详情页**：预设全部可关联项目（名称 / 目录 / 简介 / 标识），带系统目录选择器。

## 安装

```bash
# 本地路径安装（开发或自用）
dsh plugin --profile desktop add /absolute/path/to/dsh-linked-projects

# 或从 npm / GitHub
dsh plugin --profile desktop add dsh-linked-projects
```

装完重启 DSH（桌面版直接退出再打开）。

依赖 DSH `>= 0.2.1-rc.2`（用到 `ctx.systemPrompt.context`、`ctx.webServer`、`conversation.input.left`、`plugins.bundle.config`、`inputTriggers`）。

## 用法

### 1. 预设项目目录

侧栏 **插件 → dsh-linked-projects → 配置**，例如：

| 名称 | 标识 | 目录 | 简介 |
|---|---|---|---|
| Web 前端 | `web` | `/Users/you/projects/web-app` | 面向用户的前台页面 |
| 管理后台 | `admin` | `/Users/you/projects/admin-app` | 内部运营管理界面 |

「选择目录…」打开系统目录选择器；保存时校验目录存在且是目录。标识用于 `@project:<标识>`，留空则从名称/目录名推导。

### 2. 会话里勾选

输入框左下角的 chip 显示当前所在项目，点开是勾选列表：

- **勾选**：把项目加入本会话上下文（立即写盘，下一次请求生效）；
- **切到此处**：把会话工作目录切到该项目（等同模型自己的 `working_directory`，影响相对路径、`glob`/`grep` 默认根、项目 `AGENTS.md` 的加载）；
- **回到工作区**：一旦离开了会话最初的工作区，chip 上会出现 `↩`，菜单顶部也会多一行「回到工作区 · <目录名>」，点一下切回原始目录；
- 勾选状态**按会话保存**，新会话从空开始。

### 3. `@project`

输入 `@`，候选里出现 `project:web` 这类条目，选中后会做两件事：

1. 把该项目加进本会话的关联列表（和 chip 勾选等价）；
2. 把输入框里那段 `@project:web` **替换成 `目录名(绝对路径)`** 留在提示词里。

```
后台项目是@project:admin
        ↓ 选中 project:admin 之后
后台项目是admin-app(/Users/you/projects/admin-app)
```

这样模型既能在上下文里看到项目清单，也能在当次提问里直接拿到精确路径。

## 注入的上下文

只有一段、且只在需要时出现。渲染结果形如：

```
本会话已关联 2 个项目：

- Web 前端（web） — 面向用户的前台页面
  /Users/you/projects/web-app
- 管理后台（admin） — 内部运营管理界面
  /Users/you/projects/admin-app
```

设计取舍：

- 走 **runtime context**（和 `Current working directory`、文件策略同一通道），不是 system prompt：勾选变化时追加一份新快照，不重写稳定前缀，KV cache 不受影响；
- **只放事实**：名称、路径、一句话简介。要不要跨项目一起改，是模型结合任务判断的事，不写成指令；
- **抑制规则**：没有任何关联项目 → 不出现；只关联了一个、且正好是当前工作目录所在项目 → 整段不出现（默认单 workspace 场景 DSH 已经用 `Current working directory` 描述过了）。

## 权限边界（重要）

DSH 的写入沙箱根是**会话创建时的 workspace**，切换工作目录只改"看和搜"的范围，不改写入边界。所以：

- workspace 在 `admin-app` 时，直接写 `web-app` 会被沙箱拦截，需要一次性审批升级；
- 需要频繁跨仓库写，就把会话权限切到 `danger-full-access`，或把几个仓库放进同一个父目录、用父目录做 workspace。

插件不绕开沙箱，也不假装能绕开。

## 数据

```
$DSH_HOME/storages/linked-projects/catalog.json    # 项目目录库
$DSH_HOME/storages/linked-projects/sessions.json   # { sessionId: [projectId] }
```

都是普通 JSON，写入是 tmp+rename 原子替换。手工改文件后需要重启 DSH（运行时读内存副本）。

## 已知限制

- 关联关系按 sessionId 存，**fork 出来的新会话不继承**；
- 项目必须在本地文件系统上有可读目录；远端 workspace 场景未验证；
- 插件详情页的自定义配置页依赖 `plugins.bundle.config` 槽位（DSH 0.2.1-rc.2 起）。

## 开发

```bash
node --test test/*.test.mjs    # 15 个用例：目录归一化、上下文渲染与抑制规则、存储、HTTP 路由、client bundle
```

无构建步骤：host 是普通 ESM，client 是手写的 `window.__ModuleLoader__` bundle（只用 `require("react")`），改完直接装。

## License

MIT
