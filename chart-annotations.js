const strokes = {solid:[],dash:[7,5],dot:[1,4]};
function gap(px, py, [x1,y1], [x2,y2]) {
  const dx=x2-x1, dy=y2-y1;
  const position=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(px-x1-position*dx,py-y1-position*dy);
}

export function renderAnnotations(ctx, drawings, view, selected) {
  const targets = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, view.top, view.width, view.bottom - view.top);
  ctx.clip();
  ctx.strokeStyle = "#e6ba6e";
  ctx.fillStyle = "#fae0ad";
  ctx.lineWidth = 1.3;
  ctx.font = "11px system-ui";
  for (const drawing of drawings) {
    const color = drawing.color || "#e6ba6e";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = drawing === selected ? 2.5 : 1.3;
    ctx.setLineDash(strokes[drawing.style] || []);
    const targetsForDrawing = [];
    targets.push([drawing, targetsForDrawing]);
    const points = drawing.points.map(p => [view.xAt(p.time), view.y(p.price)]);
    const [[x, y], second, third] = points;
    function line(path) {
      for (let i=1; i<path.length; i+=1) targetsForDrawing.push([path[i-1],path[i]]);
      ctx.beginPath();
      for (const [px, py] of path) ctx.lineTo(px, py);
      ctx.stroke();
    }
    if (drawing.type === "horizontal") line([[0, y], [view.width, y]]);
    else if (drawing.type === "vertical") line([[x, view.top], [x, view.bottom]]);
    else if (drawing.type === "note") {
      ctx.fillRect(x - 2, y - 2, 4, 4);
      ctx.fillText(drawing.text, x + 5, y - 6);
      targetsForDrawing.push([[x,y],[x+ctx.measureText(drawing.text).width+5,y-6]]);
    } else if (drawing.type === "extended" && second) {
      const [endX, endY] = second;
      if (x === endX) line([[x,view.top],[x,view.bottom]]);
      else {
        const slope = (endY-y)/(endX-x);
        line([[0,y-x*slope],[view.width,y+(view.width-x)*slope]]);
      }
    } else if (second && (drawing.type === "fibonacci" || (drawing.type === "extension" && third))) {
      const isExtension = drawing.type === "extension";
      const levels = isExtension ? [.618,1,1.272,1.618,2,2.618] : [0,.236,.382,.5,.618,.786,1];
      const begin = isExtension ? third[0] : Math.min(x, second[0]);
      for (const level of levels) {
        const [first, last, pivot] = drawing.points;
        const price = (isExtension ? pivot.price : first.price) + level * (last.price-first.price);
        const levelY = view.y(price);
        if (!Number.isFinite(levelY)) continue;
        line([[begin, levelY], [view.width, levelY]]);
        ctx.fillText((level * 100).toFixed(1) + "%  " + price.toFixed(2), Math.max(8,begin+4), levelY-4);
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
  return (px,py) => {
    if (px<0 || px>view.width || py<view.top || py>view.bottom) return null;
    let nearest = null, threshold = 13;
    for (const [drawing,segments] of targets) {
      for (const segment of segments) {
        const distance=gap(px,py,...segment);
        if (distance <= threshold) {
          nearest=drawing;
          threshold=distance;
        }
      }
    }
    return nearest;
  };
}
