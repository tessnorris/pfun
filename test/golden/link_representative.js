(function() {
  "use strict";

  let $initializations = 0;
  const $mods = Object.create(null);
  const $maps = Object.create(null);
  const $cache = Object.create(null);

  function $own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function $req(id) {
    if ($own($cache, id)) return $cache[id].exports;
    if (!$own($mods, id)) {
      throw new Error("Pfun module not found: " + id);
    }

    const module = { exports: {} };
    $cache[id] = module;
    const map = $maps[id] || Object.create(null);
    const $require = (raw) => {
      const target = $own(map, raw) ? map[raw] : raw;
      return $req(target);
    };

    $mods[id](module.exports, $require);
    return module.exports;
  }

  $maps["once"] = {};
  $mods["once"] = (exports, $require) => {
    $initializations = $initializations + 1;
    exports["count"] = $initializations;
  };

  $maps["main"] = {"./once": "once"};
  $mods["main"] = (exports, $require) => {
    const first = $require("./once");
    const second = $require("./once");
    if (first !== second) {
      throw new Error("cache returned different exports objects");
    }
    if ($initializations !== 1) {
      throw new Error("module initialized more than once");
    }
    console.log("link-cache-ok");
  };

  $req("main");
})();
