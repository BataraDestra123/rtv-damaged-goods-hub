/**
 * Core UI toolkit — vanilla JS replacement for Webix.
 * Provides: DOM builder, toast, modal, confirm dialog, simple table
 * renderer, and a tiny hash router. No external dependencies.
 */
var RtvUI = (function () {
  "use strict";

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------- DOM builder ----------------
  // el("div", {class: "foo", onclick: fn}, [child1, "text", child2])
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var val = attrs[key];
      if (val === undefined || val === null || val === false) return;
      if (key === "class") node.className = val;
      else if (key === "html") node.innerHTML = val;
      else if (key.indexOf("on") === 0 && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === "style" && typeof val === "object") {
        Object.assign(node.style, val);
      } else if (val === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, val);
      }
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function mount(container, node) {
    clear(container);
    container.appendChild(node);
  }

  // ---------------- Toast ----------------
  var toastStack = null;
  function ensureToastStack() {
    if (!toastStack) {
      toastStack = el("div", { class: "rtv-toast-stack" });
      document.body.appendChild(toastStack);
    }
    return toastStack;
  }

  function toast(message, type, duration) {
    var stack = ensureToastStack();
    type = type || "info";
    var icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    var node = el("div", { class: "rtv-toast " + type }, [
      el("i", { class: "fa-solid " + icon }),
      el("span", {}, [message]),
    ]);
    stack.appendChild(node);
    setTimeout(function () {
      node.style.transition = "opacity .25s, transform .25s";
      node.style.opacity = "0";
      node.style.transform = "translateX(16px)";
      setTimeout(function () { node.remove(); }, 260);
    }, duration || 3800);
  }

  // ---------------- Modal ----------------
  var modalStackEls = [];

  function closeTopModal() {
    var top = modalStackEls.pop();
    if (top && top.parentNode) top.parentNode.removeChild(top);
  }

  function openModal(opts) {
    opts = opts || {};
    var backdrop = el("div", { class: "rtv-modal-backdrop" });
    var modal = el("div", { class: "rtv-modal" + (opts.wide ? " rtv-modal-wide" : "") });

    var header = el("div", { class: "rtv-modal-header" }, [
      el("h3", {}, [opts.title || ""]),
      el("button", {
        class: "rtv-modal-close", type: "button", "aria-label": "Tutup",
        onclick: function () { closeHandle(); },
      }, [el("i", { class: "fa-solid fa-xmark" })]),
    ]);

    var body = el("div", { class: "rtv-modal-body" });
    if (opts.bodyNode) body.appendChild(opts.bodyNode);
    else if (opts.bodyHtml) body.innerHTML = opts.bodyHtml;

    modal.appendChild(header);
    modal.appendChild(body);

    var footerButtons = opts.footer || [];
    if (footerButtons.length) {
      var footer = el("div", { class: "rtv-modal-footer" });
      footerButtons.forEach(function (btn) {
        var bEl = el("button", {
          type: "button",
          class: "rtv-btn " + (btn.variant === "danger" ? "rtv-btn-danger" : btn.variant === "ghost" ? "rtv-btn-ghost" : "rtv-btn-primary"),
          onclick: function () {
            var result = btn.onClick ? btn.onClick() : undefined;
            if (btn.closeOnClick !== false && result !== false) closeHandle();
          },
        }, [btn.label]);
        footer.appendChild(bEl);
      });
      modal.appendChild(footer);
    }

    backdrop.appendChild(modal);
    backdrop.addEventListener("mousedown", function (e) {
      if (e.target === backdrop && opts.dismissOnBackdrop !== false) closeHandle();
    });
    document.body.appendChild(backdrop);
    modalStackEls.push(backdrop);

    function closeHandle() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      var idx = modalStackEls.indexOf(backdrop);
      if (idx > -1) modalStackEls.splice(idx, 1);
      if (opts.onClose) opts.onClose();
    }

    if (opts.onMount) opts.onMount(body, closeHandle);

    return { close: closeHandle, bodyEl: body, backdropEl: backdrop };
  }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var handle = openModal({
        title: opts.title || "Konfirmasi",
        bodyHtml: "<p style='margin:0;color:var(--rtv-text-muted);font-size:13.5px;line-height:1.6;'>" + escapeHtml(opts.text || "") + "</p>",
        footer: [
          {
            label: opts.cancelText || "Batal", variant: "ghost",
            onClick: function () { resolve(false); },
          },
          {
            label: opts.okText || "Ya, Lanjutkan", variant: opts.danger ? "danger" : "primary",
            onClick: function () { resolve(true); },
          },
        ],
        onClose: function () {},
      });
      void handle;
    });
  }

  // ---------------- Table renderer ----------------
  // columns: [{key, header, render(row), width, align, className}]
  function renderTable(opts) {
    opts = opts || {};
    var columns = opts.columns || [];
    var rows = opts.rows || [];
    var wrap = el("div", { class: "rtv-table-wrap" });
    var table = el("table", { class: "rtv-table" });
    var thead = el("thead", {}, [
      el("tr", {}, columns.map(function (c) {
        return el("th", { style: c.width ? { width: c.width } : {} }, [c.header || ""]);
      })),
    ]);
    var tbody = el("tbody");
    if (!rows.length) {
      var tr = el("tr", {}, [
        el("td", { colspan: String(columns.length) }, [
          el("div", { class: "rtv-table-empty" }, [opts.emptyText || "Belum ada data."]),
        ]),
      ]);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (row) {
        var tr = el("tr", {});
        columns.forEach(function (c) {
          var td = el("td", { class: c.className || "", style: c.align ? { textAlign: c.align } : {} });
          var content = c.render ? c.render(row) : row[c.key];
          if (content instanceof Node) td.appendChild(content);
          else if (typeof content === "string" && c.html) td.innerHTML = content;
          else td.appendChild(document.createTextNode(content === undefined || content === null ? "-" : String(content)));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // html-content variant: allows c.render to return an HTML string that gets inserted via innerHTML
  function renderTableHtml(opts) {
    opts = opts || {};
    var columns = opts.columns || [];
    var rows = opts.rows || [];
    var wrap = el("div", { class: "rtv-table-wrap" });
    var html = "<table class='rtv-table'><thead><tr>";
    columns.forEach(function (c) {
      html += "<th" + (c.width ? " style='width:" + c.width + "'" : "") + ">" + escapeHtml(c.header || "") + "</th>";
    });
    html += "</tr></thead><tbody>";
    if (!rows.length) {
      html += "<tr><td colspan='" + columns.length + "'><div class='rtv-table-empty'>" + escapeHtml(opts.emptyText || "Belum ada data.") + "</div></td></tr>";
    } else {
      rows.forEach(function (row) {
        html += "<tr>";
        columns.forEach(function (c) {
          var content = c.render ? c.render(row) : row[c.key];
          var align = c.align ? " style='text-align:" + c.align + "'" : "";
          html += "<td" + align + ">" + (content === undefined || content === null ? "-" : content) + "</td>";
        });
        html += "</tr>";
      });
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;
    if (opts.onRowAction) {
      wrap.addEventListener("click", function (e) {
        var actionEl = e.target.closest("[data-action]");
        if (!actionEl || !wrap.contains(actionEl)) return;
        opts.onRowAction(actionEl.getAttribute("data-action"), actionEl.getAttribute("data-id"), actionEl);
      });
    }
    return wrap;
  }

  function spinner(dark) {
    return el("span", { class: "rtv-spinner" + (dark ? " dark" : "") });
  }

  function pageLoading() {
    return el("div", { class: "rtv-page-loading" }, [spinner(true)]);
  }

  // ---------------- Tiny hash router ----------------
  var routes = {};
  var defaultRoute = null;

  function routerRegister(name, handler) {
    routes[name] = handler;
  }

  function routerSetDefault(name) {
    defaultRoute = name;
  }

  function routerNavigate(name) {
    window.location.hash = "#/" + name;
  }

  function routerCurrent() {
    var h = window.location.hash.replace(/^#\/?/, "");
    return h || defaultRoute;
  }

  function routerDispatch() {
    var name = routerCurrent();
    var handler = routes[name];
    if (!handler && defaultRoute) {
      handler = routes[defaultRoute];
      name = defaultRoute;
    }
    if (handler) handler(name);
  }

  function routerInit() {
    window.addEventListener("hashchange", routerDispatch);
  }

  // ---------------- Grafik (Bar Chart & Donut Chart) ----------------
  // Dibuat dari SVG mentah (tanpa library chart pihak ketiga), supaya
  // konsisten dengan filosofi aplikasi yang tidak bergantung ke CDN UI
  // eksternal (seperti Webix yang sudah dihapus sebelumnya).
  function barChart(opts) {
    opts = opts || {};
    var width = opts.width || 560;
    var height = opts.height || 220;
    var padding = { top: 20, right: 16, bottom: 36, left: 34 };
    var data = opts.data || [];
    var maxVal = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    var chartW = width - padding.left - padding.right;
    var chartH = height - padding.top - padding.bottom;
    var barGap = 14;
    var barW = data.length ? Math.max(8, chartW / data.length - barGap) : 0;

    var gridLines = "";
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var y = padding.top + chartH - (chartH * t) / ticks;
      var val = Math.round((maxVal * t) / ticks);
      gridLines +=
        '<line x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y +
        '" stroke="var(--rtv-border)" stroke-width="1"></line>' +
        '<text x="' + (padding.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="var(--rtv-text-muted)">' + val + "</text>";
    }

    var bars = "";
    var labels = "";
    data.forEach(function (d, i) {
      var barH = maxVal > 0 ? (d.value / maxVal) * chartH : 0;
      var x = padding.left + i * (barW + barGap) + barGap / 2;
      var y = padding.top + chartH - barH;
      bars +=
        '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(barH, 1) +
        '" rx="4" fill="' + (opts.color || "var(--rtv-blue)") + '"></rect>' +
        '<text x="' + (x + barW / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="11" font-weight="600" fill="var(--rtv-text)">' + d.value + "</text>";
      labels +=
        '<text x="' + (x + barW / 2) + '" y="' + (height - padding.bottom + 18) + '" text-anchor="middle" font-size="10.5" fill="var(--rtv-text-muted)">' +
        escapeHtml(d.label) + "</text>";
    });

    return (
      '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' +
      gridLines + bars + labels + "</svg>"
    );
  }

  function donutChart(opts) {
    opts = opts || {};
    var data = (opts.data || []).filter(function (d) { return d.value > 0; });
    var size = opts.size || 180;
    var cx = size / 2, cy = size / 2, r = size / 2 - 8, inner = r * 0.6;
    var total = data.reduce(function (s, d) { return s + d.value; }, 0) || 1;
    var colors = opts.colors || ["#2f7ed8", "#f2994a", "#27ae60", "#9673a6", "#e4584c", "#17a2b8", "#e0b029"];

    if (!data.length) {
      return { svg: '<div class="rtv-table-empty">Belum ada data.</div>', legend: "" };
    }

    var startAngle = -90;
    var paths = "";
    var legend = "";
    data.forEach(function (d, i) {
      var angle = (d.value / total) * 360;
      var endAngle = startAngle + angle;
      var large = angle > 180 ? 1 : 0;
      var rad = Math.PI / 180;
      var x1 = cx + r * Math.cos(startAngle * rad), y1 = cy + r * Math.sin(startAngle * rad);
      var x2 = cx + r * Math.cos(endAngle * rad), y2 = cy + r * Math.sin(endAngle * rad);
      var ix1 = cx + inner * Math.cos(startAngle * rad), iy1 = cy + inner * Math.sin(startAngle * rad);
      var ix2 = cx + inner * Math.cos(endAngle * rad), iy2 = cy + inner * Math.sin(endAngle * rad);
      var color = colors[i % colors.length];
      paths +=
        '<path d="M' + x1 + "," + y1 + " A" + r + "," + r + " 0 " + large + " 1 " + x2 + "," + y2 +
        " L" + ix2 + "," + iy2 + " A" + inner + "," + inner + " 0 " + large + " 0 " + ix1 + "," + iy1 +
        ' Z" fill="' + color + '"></path>';
      var pct = Math.round((d.value / total) * 100);
      legend +=
        '<div class="rtv-legend-item"><span class="rtv-legend-dot" style="background:' + color + '"></span>' +
        escapeHtml(d.label) + " <b>" + d.value + "</b> (" + pct + "%)</div>";
      startAngle = endAngle;
    });

    var svg = '<svg viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">' + paths + "</svg>";
    return { svg: svg, legend: legend };
  }

  return {
    escapeHtml: escapeHtml,
    el: el,
    clear: clear,
    mount: mount,
    toast: toast,
    openModal: openModal,
    confirmDialog: confirmDialog,
    renderTable: renderTable,
    renderTableHtml: renderTableHtml,
    spinner: spinner,
    pageLoading: pageLoading,
    barChart: barChart,
    donutChart: donutChart,
    router: {
      register: routerRegister,
      setDefault: routerSetDefault,
      navigate: routerNavigate,
      current: routerCurrent,
      dispatch: routerDispatch,
      init: routerInit,
    },
  };
})();