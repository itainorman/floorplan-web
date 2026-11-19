// The measuring maths, kept free of any browser code so it can be tested on its own.
//
// How a phone without a depth sensor measures a room:
// the phone is held at a known height, and its tilt sensors say exactly where the camera points.
// Aim the camera at a spot on the floor and simple geometry gives how far away that spot is.
(function (root) {
  "use strict";

  var DEG = Math.PI / 180;
  var MAX_DISTANCE = 15; // metres; beyond this the aim is too close to the horizon to trust
  var AXIS_TOLERANCE = Math.tan(20 * DEG);

  // Which way the back camera points, from the browser's tilt readings (degrees).
  // The result uses x = east, y = north, z = up, relative to wherever the phone started.
  function cameraDirection(alpha, beta, gamma) {
    var a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
    var cA = Math.cos(a), sA = Math.sin(a);
    var cB = Math.cos(b), sB = Math.sin(b);
    var cG = Math.cos(g), sG = Math.sin(g);
    // The camera looks out of the back of the phone: the opposite of the screen's direction.
    return {
      x: -(cG * sA * sB + cA * sG),
      y: -(sA * sG - cA * cG * sB),
      z: -(cB * cG),
    };
  }

  // Where the camera's aim meets the floor, as a point on the plan in metres
  // (x to the right, y down the page, the phone at 0,0). Null when aimed too high.
  function floorPoint(dir, height) {
    if (!dir || dir.z > -0.05) return null;
    var k = height / -dir.z;
    var x = dir.x * k, y = -dir.y * k;
    if (Math.hypot(x, y) > MAX_DISTANCE) return null;
    return { x: x, y: y };
  }

  function rotate(points, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    return points.map(function (p) {
      return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
    });
  }

  // Turns the outline so its walls line up with the page edges.
  function straighten(points) {
    var sumSin = 0, sumCos = 0;
    for (var i = 0; i < points.length; i++) {
      var a = points[i], b = points[(i + 1) % points.length];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var theta = Math.atan2(b.y - a.y, b.x - a.x);
      // Multiplying by 4 makes walls at 0, 90, 180 and 270 degrees all vote for the same direction.
      sumSin += len * Math.sin(4 * theta);
      sumCos += len * Math.cos(4 * theta);
    }
    if (sumSin === 0 && sumCos === 0) return points.slice();
    return rotate(points, -Math.atan2(sumSin, sumCos) / 4);
  }

  // Hand-aimed corners are never perfectly square. This straightens the outline and makes
  // every wall that is nearly level or nearly upright exactly so. Slanted walls are left alone.
  function squareUp(points) {
    if (points.length < 3) return points.slice();
    var pts = straighten(points);
    var n = pts.length;

    var edges = [];
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dy <= dx * AXIS_TOLERANCE) edges.push({ type: "H", offset: (a.y + b.y) / 2 });
      else if (dx <= dy * AXIS_TOLERANCE) edges.push({ type: "V", offset: (a.x + b.x) / 2 });
      else edges.push({ type: "D" });
    }

    return pts.map(function (p, i) {
      var around = [edges[(i - 1 + n) % n], edges[i]];
      var xs = around.filter(function (e) { return e.type === "V"; }).map(function (e) { return e.offset; });
      var ys = around.filter(function (e) { return e.type === "H"; }).map(function (e) { return e.offset; });
      var mean = function (v) { return v.reduce(function (s, x) { return s + x; }, 0) / v.length; };
      return { x: xs.length ? mean(xs) : p.x, y: ys.length ? mean(ys) : p.y };
    });
  }

  function area(points) {
    var sum = 0;
    for (var i = 0; i < points.length; i++) {
      var a = points[i], b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function bounds(points) {
    var xs = points.map(function (p) { return p.x; });
    var ys = points.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    return {
      minX: minX, minY: minY,
      width: Math.max.apply(null, xs) - minX,
      height: Math.max.apply(null, ys) - minY,
    };
  }

  // A made-up L-shaped room, as it would come out of slightly shaky aiming.
  function sampleCorners() {
    return rotate([
      { x: -2.05, y: -1.48 }, { x: 2.02, y: -1.55 }, { x: 1.96, y: 0.42 },
      { x: 0.31, y: 0.47 }, { x: 0.27, y: 1.52 }, { x: -1.98, y: 1.47 },
    ], 0.35);
  }

  var api = {
    cameraDirection: cameraDirection,
    floorPoint: floorPoint,
    rotate: rotate,
    squareUp: squareUp,
    area: area,
    bounds: bounds,
    sampleCorners: sampleCorners,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== "undefined" ? self : this);
