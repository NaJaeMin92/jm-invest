export function renderAnnotations(ctx, drawings, view) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, view.top, view.width, view.bottom - view.top);
  ctx.clip();
  ctx.strokeStyle = "#e6ba6e";
  ctx.fillStyle = "#fae0ad";
  ctx.lineWidth = 1.3;
  ctx.font = "11px system-ui";
  for (const drawing of drawings) {
    const points = drawing.points.map(p => [view.xAt(p.time), view.y(p.price)]);
    const [[x, y], second, third] = points;
    function line(path) {
      ctx.beginPath();
      for (const [px, py] of path) ctx.lineTo(px, py);
      ctx.stroke();
    }
    if (drawing.type === "horizontal") line([[0, y], [view.width, y]]);
    else if (drawing.type === "vertical") line([[x, view.top], [x, view.bottom]]);
    else if (drawing.type === "note") {
      ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.fillText(drawing.text, x + 5, y - 6);
    } else if (drawing.type === "fibonacci" && second) {
      const [endX] = second;
      for (const level of [0, .236, .382, .5, .618, .786, 1]) {
        const [first, last] = drawing.points;
        const price = first.price + level * (last.price - first.price);
        const levelY = view.y(price);
        line([[Math.min(x, endX), levelY], [view.width, levelY]]);
        ctx.fillText((level * 100).toFixed(1) + "%  " + price.toFixed(2), Math.max(8, Math.min(x, endX) + 4), levelY - 4);
      }
    } else if (drawing.type === "parallel" && third) {
      const [endX, endY] = second;
      const offset = third[1] - (y + (endY - y) * (third[0] - x) / (endX - x || 1));
      line([[x, y], second]);
      line([[x, y + offset], [endX, endY + offset]]);
    } else {
      line(points);
      if (drawing.type === "measure" && second) {
        const [first, last] = drawing.points;
        const change = last.price - first.price;
        const label = (change >= 0 ? "+" : "") + change.toFixed(2)
          + (first.price ? " (" + (100 * change / first.price).toFixed(2) + "%)" : "");
        ctx.fillText(label, Math.max(8, Math.min(x, second[0]) + 3), Math.min(y, second[1]) - 6);
      }
    }
    if (points.length === 1 && !["note", "horizontal", "vertical"].includes(drawing.type)) {
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  ctx.restore();
}
