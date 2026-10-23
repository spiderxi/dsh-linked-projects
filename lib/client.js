window.__ModuleLoader__.load({id:"dsh-linked-projects",factory:(require)=>{const module={exports:{}};const exports=module.exports;
/**
 * dsh-linked-projects — browser half.
 *
 * Hand-written loader bundle (no build step): React only, plain
 * `React.createElement`. Three surfaces:
 *   1. a composer chip (`conversation.input.left`) listing the session's linked
 *      projects, with checkboxes and a "enter" action per project,
 *   2. the catalog editor shown on the plugin's own detail page
 *      (`plugins.bundle.config`).
 */
"use strict";

const React = require("react");
const h = React.createElement;

const NS = "linked-projects";
const ROUTE = "/api/linked-projects";
const BUNDLE = "dsh-linked-projects";

// ---------------------------------------------------------------------------
// dictionaries
// ---------------------------------------------------------------------------

const zh = {
  "chip.label": "项目",
  "chip.linked": "已关联 {n}",
  "menu.title": "本会话关联的项目",
  "menu.empty": "还没有预设项目。在「插件 → dsh-linked-projects → 配置」里添加。",
  "menu.enter": "切到此处",
  "menu.back": "回到工作区",
  "menu.workspaceTag": "工作区",
  "menu.manage": "在插件页管理项目目录",
  "menu.hint": "勾选 = 加入本会话上下文；「切到此处」= 把工作目录切到该项目",
  "settings.title": "关联项目目录",
  "settings.subtitle": "预设所有可关联的项目：名称、目录、一句话简介。勾选哪几个由每个会话自己决定。",
  "settings.name": "名称",
  "settings.slug": "标识",
  "settings.path": "目录",
  "settings.description": "简介",
  "settings.pick": "选择目录…",
  "settings.add": "添加项目",
  "settings.remove": "删除",
  "settings.up": "上移",
  "settings.down": "下移",
  "settings.save": "保存",
  "settings.saved": "已保存",
  "settings.saving": "保存中…",
  "settings.empty": "还没有项目，先添加一个。",
  "settings.needPath": "请先填写项目目录",
  "settings.pickerUnavailable": "当前宿主不支持系统目录选择器，请手动填写绝对路径",
  "settings.placeholderName": "例如 Web 前端",
  "settings.placeholderSlug": "例如 web",
  "settings.placeholderPath": "/Users/you/projects/web-app",
  "settings.placeholderDescription": "面向用户的前台页面",
  "error.generic": "操作失败",
};

const en = {
  "chip.label": "Projects",
  "chip.linked": "{n} linked",
  "menu.title": "Linked projects in this session",
  "menu.empty": "No projects yet. Add them under Plugins → dsh-linked-projects → Configure.",
  "menu.enter": "Switch here",
  "menu.back": "Back to workspace",
  "menu.workspaceTag": "workspace",
  "menu.manage": "Manage project directories on the plugin page",
  "menu.hint": "Checked = part of this session's context; Switch here = change the working directory",
  "settings.title": "Linked project directories",
  "settings.subtitle": "Preset every linkable project (name, directory, one-line description). Each session picks its own subset.",
  "settings.name": "Name",
  "settings.slug": "Slug",
  "settings.path": "Directory",
  "settings.description": "Description",
  "settings.pick": "Choose…",
  "settings.add": "Add project",
  "settings.remove": "Remove",
  "settings.up": "Move up",
  "settings.down": "Move down",
  "settings.save": "Save",
  "settings.saved": "Saved",
  "settings.saving": "Saving…",
  "settings.empty": "No projects yet — add one.",
  "settings.needPath": "Fill in the project directory first",
  "settings.pickerUnavailable": "This host has no system directory picker; type an absolute path instead",
  "settings.placeholderName": "e.g. Web frontend",
  "settings.placeholderSlug": "e.g. web",
  "settings.placeholderPath": "/Users/you/projects/web-app",
  "settings.placeholderDescription": "User-facing web pages",
  "error.generic": "Request failed",
};

// ---------------------------------------------------------------------------
// tiny shared state so the chip and the catalog page stay in sync
// ---------------------------------------------------------------------------

const watchers = new Set();

function notifyChanged() {
  for (const watcher of [...watchers]) {
    try {
      watcher();
    } catch (error) {
      console.error("[linked-projects] watcher failed:", error);
    }
  }
}

function subscribe(watcher) {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

// ---------------------------------------------------------------------------
// host API
// ---------------------------------------------------------------------------

async function request(path, init) {
  const response = await fetch(`${ROUTE}${path}`, {
    credentials: "same-origin",
    ...init,
  });
  const text = await response.text();
  let data = {};
  if (text !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function loadState(sessionId, cwd, signal) {
  const params = new URLSearchParams();
  if (typeof sessionId === "string" && sessionId !== "") params.set("sessionId", sessionId);
  if (typeof cwd === "string" && cwd !== "") params.set("cwd", cwd);
  return request(`/state?${params.toString()}`, signal === undefined ? undefined : { signal });
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const s = {
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: 180,
    height: 24,
    padding: "0 8px",
    borderRadius: 8,
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.28))",
    background: "transparent",
    color: "var(--dsw-alias-label-secondary, #666)",
    font: "inherit",
    fontSize: 12,
    lineHeight: "22px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  chipLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chevron: { fontSize: 9, opacity: 0.7 },
  menu: {
    position: "fixed",
    zIndex: 9999,
    minWidth: 300,
    maxWidth: 420,
    padding: 6,
    borderRadius: 10,
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.28))",
    background: "var(--dsw-alias-bg-module-platform, #fff)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
    color: "var(--dsw-alias-label-primary, #222)",
    fontSize: 13,
  },
  menuTitle: {
    padding: "6px 8px 4px",
    fontSize: 11,
    color: "var(--dsw-alias-label-caption, #888)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
  },
  rowName: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 },
  rowTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowSub: {
    fontSize: 11,
    color: "var(--dsw-alias-label-tertiary, #999)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  check: {
    width: 14,
    height: 14,
    borderRadius: 4,
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.4))",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: "var(--dsw-alias-bg-module-platform, #fff)",
    flex: "0 0 auto",
  },
  checkOn: { background: "var(--dsw-alias-state-business-primary, #3b6cf6)", borderColor: "transparent" },
  enter: {
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.28))",
    background: "transparent",
    color: "var(--dsw-alias-label-secondary, #666)",
    borderRadius: 6,
    padding: "1px 6px",
    fontSize: 11,
    cursor: "pointer",
    flex: "0 0 auto",
  },
  hint: {
    padding: "4px 8px 6px",
    fontSize: 11,
    color: "var(--dsw-alias-label-tertiary, #999)",
  },
  empty: { padding: "8px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #999)" },
  divider: { height: 1, margin: "4px 2px", background: "var(--dsw-alias-border-l, rgba(127,127,127,0.2))" },
  field: {
    width: "100%",
    boxSizing: "border-box",
    padding: "4px 6px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.28))",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
  },
  button: {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.28))",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
  },
  primary: { background: "var(--dsw-alias-state-business-primary, #3b6cf6)", borderColor: "transparent", color: "#fff" },
  danger: { color: "var(--dsw-alias-state-error-primary, #d14343)" },
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function basenameOf(path) {
  if (typeof path !== "string") return "";
  const clean = path.replace(/[/\\]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index < 0 ? clean : clean.slice(index + 1);
}

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left === "" || right === "") return false;
  const strip = (value) => value.replace(/[/\\]+$/, "");
  return strip(left) === strip(right);
}

function withFallback(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// composer chip
// ---------------------------------------------------------------------------

function ProjectChip(props) {
  const t = props.t;
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
  const [state, setState] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const chipRef = React.useRef(null);

  const cwd = props.cwd;

  const refresh = React.useCallback(() => {
    if (sessionId === "") return;
    let alive = true;
    loadState(sessionId, cwd)
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((error) => {
        if (alive) console.error("[linked-projects] state failed:", error);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, cwd]);

  React.useEffect(() => refresh(), [refresh]);

  React.useEffect(() => {
    const off = subscribe(refresh);
    return () => {
      off();
    };
  }, [refresh]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (chipRef.current !== null && chipRef.current.contains(event.target)) return;
      const menu = document.getElementById("dsh-linked-projects-menu");
      if (menu !== null && menu.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (sessionId === "" || state === null || state.projects.length === 0) return null;

  const linked = new Set(state.linked);
  const workspace = typeof state.workspace === "string" ? state.workspace : "";
  const away = workspace !== "" && state.current !== "" && !samePath(state.current, workspace);
  const current = state.currentProject === null ? undefined : state.projects.find((p) => p.id === state.currentProject);
  const label = current !== undefined ? current.name : basenameOf(state.current) || t("chip.label");

  const toggle = (project) => {
    const next = linked.has(project.id) ? { remove: [project.id] } : { add: [project.id] };
    setBusy(true);
    post("/link", { sessionId, ...next })
      .then((result) => {
        setState({ ...state, linked: result.linked ?? [] });
        notifyChanged();
        setBusy(false);
      })
      .catch((error) => {
        console.error("[linked-projects] link failed:", error);
        setBusy(false);
      });
  };

  const enter = (project) => {
    setBusy(true);
    post("/cwd", { sessionId, projectId: project.id })
      .then((result) => {
        setState({ ...state, current: result.cwd, currentProject: project.id });
        setBusy(false);
        setOpen(false);
      })
      .catch((error) => {
        console.error("[linked-projects] cwd failed:", error);
        setBusy(false);
      });
  };

  const enterPath = (path) => {
    setBusy(true);
    post("/cwd", { sessionId, path })
      .then((result) => {
        setState({ ...state, current: result.cwd, currentProject: null });
        setBusy(false);
        setOpen(false);
      })
      .catch((error) => {
        console.error("[linked-projects] cwd failed:", error);
        setBusy(false);
      });
  };

  const openMenu = () => {
    const node = chipRef.current;
    if (node !== null) setAnchor(node.getBoundingClientRect());
    setOpen((value) => !value);
    refresh();
  };

  const menu =
    open && anchor !== null
      ? h(
          "div",
          {
            id: "dsh-linked-projects-menu",
            style: {
              ...s.menu,
              left: Math.max(8, Math.min(anchor.left, (window.innerWidth || 1200) - 430)),
              bottom: (window.innerHeight || 800) - anchor.top + 6,
            },
          },
          h("div", { style: s.menuTitle }, t("menu.title")),
          away
            ? h(
                "div",
                {
                  key: "__workspace__",
                  style: { ...s.row, background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08))" },
                  onClick: () => (busy ? undefined : enterPath(workspace)),
                  title: workspace,
                },
                h("span", { style: { width: 14, textAlign: "center", opacity: 0.7 } }, "↩"),
                h(
                  "span",
                  { style: s.rowName },
                  h("span", { style: s.rowTitle }, t("menu.back")),
                  h("span", { style: s.rowSub }, basenameOf(workspace)),
                ),
              )
            : null,
          ...state.projects.map((project) =>
            h(
              "div",
              {
                key: project.id,
                style: { ...s.row, background: linked.has(project.id) ? "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08))" : "transparent" },
                onClick: () => (busy ? undefined : toggle(project)),
                title: project.path,
              },
              h("span", { style: { ...s.check, ...(linked.has(project.id) ? s.checkOn : {}) } }, linked.has(project.id) ? "✓" : ""),
              h(
                "span",
                { style: s.rowName },
                h("span", { style: s.rowTitle }, project.name),
                h(
                  "span",
                  { style: s.rowSub },
                  project.description === "" ? project.path : `${project.description} · ${project.path}`,
                  samePath(project.path, workspace) ? ` · ${t("menu.workspaceTag")}` : "",
                ),
              ),
              h(
                "button",
                {
                  type: "button",
                  style: s.enter,
                  onClick: (event) => {
                    event.stopPropagation();
                    if (!busy) enter(project);
                  },
                },
                t("menu.enter"),
              ),
            ),
          ),
          h("div", { style: s.divider }),
          h("div", { style: s.hint }, t("menu.hint")),
          h("div", { style: { ...s.hint, paddingTop: 0 } }, t("menu.manage")),
        )
      : null;

  return h(
    React.Fragment,
    null,
    h(
      "button",
      {
        type: "button",
        ref: chipRef,
        style: s.chip,
        onClick: openMenu,
        title: state.current === "" ? t("chip.label") : state.current,
      },
      h("span", { style: { opacity: 0.75, fontSize: 11 } }, "▣"),
      h("span", { style: s.chipLabel }, label),
      linked.size > 0 ? h("span", { style: { opacity: 0.6, fontSize: 10 } }, String(linked.size)) : null,
      away
        ? h(
            "span",
            {
              role: "button",
              title: `${t("menu.back")} · ${basenameOf(workspace)}`,
              style: { opacity: 0.75, fontSize: 11, padding: "0 2px", cursor: "pointer" },
              onClick: (event) => {
                event.stopPropagation();
                if (!busy) enterPath(workspace);
              },
            },
            "↩",
          )
        : null,
      h("span", { style: s.chevron }, "▾"),
    ),
    menu,
  );
}

// ---------------------------------------------------------------------------
// catalog editor (plugin detail page)
// ---------------------------------------------------------------------------

function emptyDraft() {
  return { id: "", name: "", slug: "", path: "", description: "" };
}

function ProjectsSettings(props) {
  const t = props.t;
  const [projects, setProjects] = React.useState(null);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    loadState("", "")
      .then((state) => setProjects(state.projects))
      .catch((failure) => setError(failure.message));
  }, []);

  React.useEffect(() => refresh(), [refresh]);

  if (projects === null) {
    return h("div", { style: { padding: 12, fontSize: 12, opacity: 0.7 } }, error === "" ? "…" : error);
  }

  const update = (index, patch) => {
    setProjects(projects.map((project, at) => (at === index ? { ...project, ...patch } : project)));
    setStatus("");
  };

  const move = (index, delta) => {
    const next = [...projects];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    setProjects(next);
    setStatus("");
  };

  const pickDirectory = async (index) => {
    setError("");
    try {
      const result = await post("/pick", {});
      if (result.available !== true || typeof result.path !== "string") {
        setError(t("settings.pickerUnavailable"));
        return;
      }
      const path = result.path;
      const patch = { path };
      if ((projects[index].name ?? "").trim() === "") patch.name = basenameOf(path);
      if ((projects[index].slug ?? "").trim() === "") patch.slug = basenameOf(path).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      update(index, patch);
    } catch (failure) {
      setError(failure.message);
    }
  };

  const save = () => {
    setBusy(true);
    setError("");
    setStatus("");
    post("/catalog", { projects })
      .then((result) => {
        setProjects(result.projects);
        setStatus(t("settings.saved"));
        setBusy(false);
        notifyChanged();
      })
      .catch((failure) => {
        setError(failure.message);
        setBusy(false);
      });
  };

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", fontSize: 13 } },
    h("div", { style: { fontWeight: 600 } }, t("settings.title")),
    h("div", { style: { fontSize: 12, opacity: 0.72, lineHeight: 1.5 } }, t("settings.subtitle")),
    projects.length === 0
      ? h("div", { style: { fontSize: 12, opacity: 0.6 } }, t("settings.empty"))
      : h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 8 } },
          ...projects.map((project, index) =>
            h(
              "div",
              {
                key: project.id === "" ? `draft-${index}` : project.id,
                style: {
                  display: "grid",
                  gridTemplateColumns: "1.1fr 0.7fr 1.6fr 1.4fr auto",
                  gap: 6,
                  alignItems: "center",
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid var(--dsw-alias-border-l, rgba(127,127,127,0.2))",
                },
              },
              h("input", {
                style: s.field,
                value: project.name,
                placeholder: t("settings.placeholderName"),
                onChange: (event) => update(index, { name: event.target.value }),
              }),
              h("input", {
                style: s.field,
                value: project.slug,
                placeholder: t("settings.placeholderSlug"),
                onChange: (event) => update(index, { slug: event.target.value }),
              }),
              h(
                "div",
                { style: { display: "flex", gap: 4, minWidth: 0 } },
                h("input", {
                  style: s.field,
                  value: project.path,
                  placeholder: t("settings.placeholderPath"),
                  onChange: (event) => update(index, { path: event.target.value }),
                }),
                h(
                  "button",
                  { type: "button", style: { ...s.button, flex: "0 0 auto" }, onClick: () => pickDirectory(index) },
                  t("settings.pick"),
                ),
              ),
              h("input", {
                style: s.field,
                value: project.description,
                placeholder: t("settings.placeholderDescription"),
                onChange: (event) => update(index, { description: event.target.value }),
              }),
              h(
                "div",
                { style: { display: "flex", gap: 2 } },
                h("button", { type: "button", style: s.button, title: t("settings.up"), onClick: () => move(index, -1) }, "↑"),
                h("button", { type: "button", style: s.button, title: t("settings.down"), onClick: () => move(index, 1) }, "↓"),
                h(
                  "button",
                  {
                    type: "button",
                    style: { ...s.button, ...s.danger },
                    onClick: () => {
                      setProjects(projects.filter((_, at) => at !== index));
                      setStatus("");
                    },
                  },
                  t("settings.remove"),
                ),
              ),
            ),
          ),
        ),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8 } },
      h(
        "button",
        {
          type: "button",
          style: s.button,
          onClick: () => {
            setProjects([...projects, emptyDraft()]);
            setStatus("");
          },
        },
        t("settings.add"),
      ),
      h("button", { type: "button", style: { ...s.button, ...s.primary }, disabled: busy, onClick: save }, busy ? t("settings.saving") : t("settings.save")),
      status !== "" ? h("span", { style: { fontSize: 12, opacity: 0.7 } }, status) : null,
      error !== "" ? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary, #d14343)" } }, error) : null,
    ),
  );
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

const inject = ["slots", "locale"];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "linked-projects: dictionaries");
  const t = ctx.locale.bind(NS);
  const sessions = withFallback(() => ctx.get("sessions", false), undefined);

  const cwdOf = (sessionId) => {
    if (sessions === undefined) return undefined;
    return withFallback(() => sessions.list.getSnapshot().byId[sessionId]?.cwd, undefined);
  };

  ctx.slots.inject("conversation.input.left", () =>
    ctx.slots.register(
      { name: "conversation.input.left", id: "linked-projects", order: 20, locale: NS },
      (props) => h(ProjectChip, { ...props, t, cwd: cwdOf(props.sessionId) }),
    ),
  );

  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      { name: "plugins.bundle.config", key: BUNDLE, locale: NS },
      (props) => h(ProjectsSettings, { ...props, t }),
    ),
  );

}

module.exports = { apply, inject };
return module.exports;}});
