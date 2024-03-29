import {
  FC,
  MouseEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import H from "@here/maps-api-for-javascript";
import onResize from "simple-element-resize-detector";

import styles from "./DisplayMap.module.scss";

type ListEdge = { [k: string]: H.geo.IPoint[] };
type ActionType = "NORMAL" | "DRAW_LINE" | "DRAW_POLYGON";

interface Equation {
  a: number;
  b: number;
  c: number;
}

interface StraightLine {
  startPoint: H.geo.IPoint;
  endPoint: H.geo.IPoint;
  equation: Equation;
}

const MARKER_SIZE = 10;

const ICONS_MAP: { style: string; actionType: ActionType }[] = [
  { style: "normalAction", actionType: "NORMAL" },
  { style: "lineDrawAction", actionType: "DRAW_LINE" },
  { style: "polygonDrawAction", actionType: "DRAW_POLYGON" },
];

const DisplayMap: FC = () => {
  const mapRef = useRef<HTMLElement>();
  const [ui, setUi] = useState<H.ui.UI>();
  const ctxRef = useRef<CanvasRenderingContext2D>();
  const renderingParamsRef = useRef<H.map.render.RenderingParams>();

  const [map, setMap] = useState<H.Map>();
  const [lineString, setLineString] = useState(new H.geo.LineString());
  const [idCurrentLine, setIdCurrentLine] = useState(Math.random());
  const [points, setPoints] = useState<H.geo.IPoint[]>([]);
  const [currentAction, setCurrentAction] = useState<ActionType>("NORMAL");

  const initMap = useCallback((lat: number, lng: number) => {
    if (mapRef.current) {
      const platform = new H.service.Platform({
        apikey: "pnYh4cMYuMq1VQ6Dn7Af1yz-L5GP1Bt1t9LYvMZAZIs",
      });
      const layers = platform.createDefaultLayers();
      const mapObj = new H.Map(mapRef.current, layers.vector.normal.map, {
        pixelRatio: window.devicePixelRatio || 1,
        center: { lat, lng },
        zoom: 5,
      });
      onResize(mapRef.current, () => {
        mapObj.getViewPort().resize();
      });
      mapObj.addLayer(
        new H.map.layer.CanvasLayer(function (
          ctx: CanvasRenderingContext2D | WebGLRenderingContext,
          renderingParams
        ) {
          if (ctx instanceof WebGLRenderingContext)
            return H.map.render.RenderState.PENDING;

          ctxRef.current = ctx;
          renderingParamsRef.current = renderingParams;
          return H.map.render.RenderState.DONE;
        })
      );
      const behavior = new H.mapevents.Behavior(
        new H.mapevents.MapEvents(mapObj)
      );
      behavior.disable(H.mapevents.Behavior.Feature.DBL_TAP_ZOOM);
      const ui = H.ui.UI.createDefault(mapObj, layers);

      setMap(mapObj);
      setUi(ui);
    }
  }, []);

  const isDrawing = useMemo(() => {
    return currentAction === "DRAW_LINE" || currentAction === "DRAW_POLYGON";
  }, [currentAction]);

  const handleChangeAction = (
    e: MouseEvent<HTMLDivElement>,
    actionType: ActionType
  ) => {
    e.stopPropagation();
    setCurrentAction((prevState) => {
      return prevState === actionType ? "NORMAL" : actionType;
    });
  };

  const handleReset = () => {
    setCurrentAction("NORMAL");
    setPoints([]);
    setIdCurrentLine(Math.random());
    setLineString(new H.geo.LineString());
    if (ctxRef.current && renderingParamsRef.current) {
      ctxRef.current.clearRect(
        0,
        0,
        renderingParamsRef.current.size.w,
        renderingParamsRef.current.size.h
      );
    }
  };

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        handleReset();

        map?.getObjects().forEach((obj) => {
          if (obj.getData()?.id === idCurrentLine) {
            map.removeObject(obj);
          }
        });
      }
    },
    [map, idCurrentLine]
  );

  // hàm lấy phương trình đường thẳng từ 2 điểm
  const getStraightLine = (
    startPoint: H.geo.IPoint,
    endPoint: H.geo.IPoint
  ): StraightLine => {
    // cy = ax + b
    let equation: Equation;
    // hoành độ bằng nhau
    if (endPoint.lat === startPoint.lat) {
      equation = { a: 1, b: -startPoint.lat, c: 0 };
    } else if (endPoint.lng === startPoint.lng) {
      // tung độ bằng nhau
      equation = { a: 0, b: startPoint.lng, c: 1 };
    } else {
      const a =
        (startPoint.lng - endPoint.lng) / (startPoint.lat - endPoint.lat);
      const b = startPoint.lng - startPoint.lat * a;
      const c = 1;
      equation = { a, b, c };
    }
    return {
      startPoint,
      endPoint,
      equation,
    };
  };

  // hàm lấy tất cả các điểm bao gồm cả điểm giao nhau
  const getAllPoints = (): H.geo.IPoint[] => {
    const llaArr = lineString.getLatLngAltArray();
    const straightLineArr: StraightLine[] = [];
    let result: H.geo.IPoint[] = [];
    let _points: H.geo.IPoint[] = [];
    for (let i = 0; i < llaArr.length - 2; i += 3) {
      _points.push({ lat: llaArr[i], lng: llaArr[i + 1], alt: llaArr[i + 2] });
    }

    // tính phương trinh đoạn thẳng của 2 điểm liên tiếp
    for (let i = 0; i < _points.length - 1; i++) {
      const startPoint = _points[i];
      const endPoint = _points[i + 1];
      straightLineArr.push(getStraightLine(startPoint, endPoint));
    }

    // tìm điểm cắt nhau giữa các đọan thẳng
    for (let i = 0; i < straightLineArr.length; i++) {
      const straightLineCurrent = straightLineArr[i];
      const {
        equation: equationCurrent,
        startPoint: startPointCurrent,
        endPoint: endPointCurrent,
      } = straightLineCurrent;
      const cutPoints: H.geo.IPoint[] = [];

      for (let j = 0; j < straightLineArr.length; j++) {
        const straightLineCheck = straightLineArr[j];

        const {
          equation: equationCheck,
          startPoint: startPointCheck,
          endPoint: endPointCheck,
        } = straightLineCheck;

        // điều kiện để 2 đoạn thẳng cắt nhau
        if (
          equationCurrent.a !== equationCheck.a &&
          j !== i + 1 &&
          j !== i - 1
        ) {
          const x =
            -(equationCurrent.b - equationCheck.b) /
            (equationCurrent.a - equationCheck.a);
          const y = equationCurrent.a * x + equationCurrent.b;

          const rangeLatCurrent = [startPointCurrent.lat, endPointCurrent.lat];
          const rangeLngCurrent = [startPointCurrent.lng, endPointCurrent.lng];
          const rangeLatCheck = [startPointCheck.lat, endPointCheck.lat];
          const rangeLngCheck = [startPointCheck.lng, endPointCheck.lng];

          if (
            x < Math.max(...rangeLatCurrent) &&
            x > Math.min(...rangeLatCurrent) &&
            y < Math.max(...rangeLngCurrent) &&
            y > Math.min(...rangeLngCurrent) &&
            x < Math.max(...rangeLatCheck) &&
            x > Math.min(...rangeLatCheck) &&
            y < Math.max(...rangeLngCheck) &&
            y > Math.min(...rangeLngCheck)
          ) {
            const _samplingError = 0.000_000_000_1;
            const pointNearest = result.find(
              (point) =>
                Math.abs(point.lat - x) <= _samplingError &&
                Math.abs(point.lng - y) <= _samplingError
            );
            const cutPoint = pointNearest ? pointNearest : { lat: x, lng: y };
            cutPoints.push(cutPoint);
          }
        }
      }

      result.push(startPointCurrent);
      if (cutPoints.length) {
        cutPoints.sort((a, b) => {
          if (startPointCurrent.lat < endPointCurrent.lat) {
            return a.lat - b.lat > 0 ? 1 : -1;
          } else {
            return a.lat - b.lat > 0 ? -1 : 1;
          }
        });
        cutPoints.sort((a, b) => {
          if (startPointCurrent.lng < endPointCurrent.lng) {
            return a.lng - b.lng > 0 ? 1 : -1;
          } else {
            return a.lng - b.lng > 0 ? -1 : 1;
          }
        });

        result.push(...cutPoints);
      }
    }
    result.push(_points[0]);
    return result;
  };

  // đệ quy lấy các điểm nối với nhau để tạo thành hình
  const recursivePoints = (
    prevKey: string,
    endPoint: H.geo.IPoint,
    pointsVisted: H.geo.IPoint[],
    _shape: H.geo.IPoint[],
    listEdge: ListEdge
  ): H.geo.IPoint[] => {
    const currentPoint: H.geo.IPoint = pointsVisted[pointsVisted.length - 1];
    const hasPoint = listEdge[prevKey].find(
      (point) => point.lat === endPoint.lat && point.lng === endPoint.lng
    );
    if (hasPoint) {
      return _shape.concat([currentPoint, endPoint]);
    } else if (listEdge[prevKey].length > 2) {
      return _shape;
    } else {
      const pointNext = listEdge[prevKey].find(
        (point) =>
          point.lat !== _shape[_shape.length - 1].lat &&
          point.lng !== _shape[_shape.length - 1].lng &&
          pointsVisted.every(
            (pointVisted) =>
              pointVisted.lat !== point.lat && pointVisted.lng !== point.lng
          )
      );
      if (pointNext) {
        const keyNext = `${pointNext.lat}-${pointNext.lng}`;
        const _newShape = pointNext ? [..._shape, currentPoint] : _shape;
        pointsVisted = [...pointsVisted, pointNext];

        return recursivePoints(
          keyNext,
          endPoint,
          pointsVisted,
          _newShape,
          listEdge
        );
      } else {
        return [];
      }
    }
  };

  const createPointMaker = (pos: H.geo.IPoint) => {
    const markerEl = document.createElement("div");
    markerEl.style.cursor = "pointer";
    markerEl.style.width = `${MARKER_SIZE}px`;
    markerEl.style.height = `${MARKER_SIZE}px`;
    markerEl.style.marginTop = `-${MARKER_SIZE / 2}px`;
    markerEl.style.marginLeft = `-${MARKER_SIZE / 2}px`;
    markerEl.style.position = "relative";
    markerEl.style.userSelect = "none";
    markerEl.style.borderRadius = "50%";
    markerEl.style.border = "1px solid #333";
    markerEl.style.backgroundColor = "white";
    const domIcon = new H.map.DomIcon(markerEl);
    const markerObj = new H.map.DomMarker(pos, {
      icon: domIcon,
    } as H.map.DomMarker.Options);
    markerObj.setData({ id: idCurrentLine });
    map?.addObject(markerObj);
  };

  const handleDraw = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDrawing) return;
    const { clientX: viewportX, clientY: viewportY } = e;
    const coord = map?.screenToGeo(viewportX, viewportY);
    let pos: H.geo.IPoint = {
      lat: coord?.lat ?? 0,
      lng: coord?.lng ?? 0,
      alt: 5,
    };

    const pointNearestIndex = points.findIndex((point) => {
      const pointCoord = map?.geoToScreen(point);
      return (
        Math.abs((pointCoord?.x || 0) - viewportX) <= MARKER_SIZE / 2 &&
        Math.abs((pointCoord?.y || 0) - viewportY) <= MARKER_SIZE / 2
      );
    });

    let isDuplicate = false;
    if (lineString.getPointCount() > 1 && points[points.length - 1]) {
      const currentLastPointCoord = map?.geoToScreen(points[points.length - 1]);
      isDuplicate =
        Math.abs((currentLastPointCoord?.x || 0) - viewportX) <=
          MARKER_SIZE / 2 &&
        Math.abs((currentLastPointCoord?.y || 0) - viewportY) <=
          MARKER_SIZE / 2;
    }

    if (pointNearestIndex === 0) {
      handleEndDraw();
      return;
    } else if (isDuplicate) {
      return;
    } else if (pointNearestIndex !== -1) {
      pos.lat = points[pointNearestIndex].lat;
      pos.lng = points[pointNearestIndex].lng;
    }

    lineString.pushPoint(pos);
    setPoints((prevState) => [...prevState, pos]);

    // danh dau diem
    createPointMaker(pos);

    if (lineString.getPointCount() > 1) {
      const polyline = new H.map.Polyline(lineString, {
        style: { lineWidth: 4 },
      } as H.map.Polyline.Options);
      polyline.setData({ id: idCurrentLine });
      map?.addObject(polyline);
    }
  };

  const getPolylineLength = (polyline: H.map.Polyline) => {
    const geometry = polyline.getGeometry() as H.geo.LineString;
    let distance = 0;
    let last = geometry.extractPoint(0);
    for (let i = 1; i < geometry.getPointCount(); i++) {
      const point = geometry.extractPoint(i);
      distance += last.distance(point);
      last = point;
    }
    if (polyline.isClosed()) {
      distance += last.distance(geometry.extractPoint(0));
    }

    return distance / 1000;
  };

  const getLastShapeIndex = useCallback(
    (typeShape: H.map.Polygon | H.map.Polyline) => {
      let index = 1;
      let polygonId;
      if (map) {
        for (let i = map.getObjects().length - 1; i >= 0; i--) {
          const obj = map.getObjects()[i];

          if (
            typeShape instanceof H.map.Polyline &&
            obj instanceof H.map.Polyline
          ) {
            index = obj.getData().index + 1;
            break;
          } else if (
            typeShape instanceof H.map.Polygon &&
            obj instanceof H.map.Polygon
          ) {
            if (polygonId && polygonId === obj.getData().id) {
              index = obj.getData().index;
            } else if (polygonId) {
              return index + 1;
            } else {
              polygonId = obj.getData().id;
              index = obj.getData().index === 1 ? 2 : obj.getData().index; //trường hợp chỉ có 1 polygon => thấy => index = 2
            }
          }
        }

        return index;
      }

      return 1;
    },
    [map]
  );

  const addEventBubble = useCallback(
    (type: H.map.Polyline | H.map.Polygon) => {
      type.addEventListener("tap", (e: any) => {
        ui?.getBubbles().forEach((obj) => {
          if (obj instanceof H.ui.InfoBubble) {
            ui.removeBubble(obj);
          }
        });

        const { viewportX, viewportY } = e.currentPointer;
        const coord = map?.screenToGeo(viewportX, viewportY);
        let pos: H.geo.IPoint = {
          lat: coord?.lat ?? 0,
          lng: coord?.lng ?? 0,
        };
        const marker = document.createElement("div");

        const deleteIcon = document.createElement("i");
        deleteIcon.className = "fas fa-trash";
        deleteIcon.style.cursor = "pointer";
        deleteIcon.style.display = "block";
        deleteIcon.style.textAlign = "right";
        deleteIcon.style.marginTop = "5px";

        if (type instanceof H.map.Polyline) {
          marker.innerHTML = `
              <h3>Đường thẳng thứ ${type.getData().index}</h3>
              <h3>Length: ${getPolylineLength(type)} km</h3>
            `;
        } else if (type instanceof H.map.Polygon) {
          marker.innerHTML = `
              <h3>Polygon thứ ${type.getData().index}</h3>
            `;
        }
        marker.appendChild(deleteIcon);

        const bubble = new H.ui.InfoBubble(pos, {
          content: marker.innerHTML,
        });
        ui?.addBubble(bubble);

        bubble
          .getElement()
          ?.getElementsByClassName("fas fa-trash")[0]
          .addEventListener("click", function () {
            map?.getObjects().forEach((obj) => {
              if (obj.getData()?.id === type.getData().id) {
                map.removeObject(obj);
              }
            });

            ui?.removeBubble(bubble);
          });
      });
    },
    [map, ui]
  );

  const handleDrawPolygon = () => {
    lineString.pushPoint(points[0]);
    setPoints([...points, points[0]]);

    const allPoints = getAllPoints();
    const listEdge = allPoints.reduce<ListEdge>(
      (result: ListEdge, point: H.geo.IPoint, index: number) => {
        const key = `${point.lat}-${point.lng}`;
        if (!result.hasOwnProperty(key)) {
          result[key] = [];
        }
        const prevIndex = index === 0 ? allPoints.length - 1 : index - 1;
        const nextIndex = index === allPoints.length - 1 ? 0 : index + 1;
        if (
          result[key].every(
            (_point) => _point.lat !== point.lat && _point.lng !== point.lng
          )
        ) {
          const valuePrev = allPoints[prevIndex];
          const valueNext = allPoints[nextIndex];
          const keyPrev = `${valuePrev.lat}-${valuePrev.lng}`;
          const keyNext = `${valueNext.lat}-${valueNext.lng}`;
          result[key] =
            keyPrev === key ? result[key] : [...result[key], valuePrev];
          result[key] =
            keyNext === key ? result[key] : [...result[key], valueNext];
        }
        return result;
      },
      {}
    );
    const shapeDrawed: H.geo.LineString[] = []; // danh sách các tập hợp điểm đã vẽ lên hình

    for (const [key, pointArr] of Object.entries(listEdge)) {
      const [prevPoint, nextPoint] = pointArr;
      const startPoint: H.geo.IPoint = {
        lat: +key.split("-")[0],
        lng: +key.split("-")[1],
      };
      const shape: H.geo.IPoint[] = [startPoint];

      const prevKey = `${prevPoint.lat}-${prevPoint.lng}`;
      const __lineString = new H.geo.LineString();
      const pointsVisted =
        pointArr.length > 2 ? [startPoint, prevPoint] : [prevPoint];

      const shapeUniq = recursivePoints(
        prevKey,
        nextPoint,
        pointsVisted,
        shape,
        listEdge
      );

      if (shapeUniq.length < 2) continue;

      shapeUniq.forEach((_point: H.geo.IPoint) =>
        __lineString.pushPoint(_point)
      );

      const inShapeDrawed = shapeDrawed.some((drawed) => {
        const lla = __lineString.getLatLngAltArray();
        const llaDrawed = drawed.getLatLngAltArray();
        return (
          llaDrawed.length === lla.length &&
          lla.every((coord: number) => llaDrawed.includes(coord))
        );
      });

      shapeDrawed.push(__lineString);
      if (!inShapeDrawed) {
        const polygon = new H.map.Polygon(new H.geo.Polygon(__lineString), {
          style: { lineWidth: 4 },
        } as H.map.Polygon.Options);

        const lastIndex = getLastShapeIndex(polygon);
        polygon.setData({ id: idCurrentLine, index: lastIndex });
        addEventBubble(polygon);
        map?.addObject(polygon);
      }
    }
  };

  const handleDrawLine = () => {
    const polyline = new H.map.Polyline(lineString, {
      style: { lineWidth: 4 },
    } as H.map.Polyline.Options);

    const lastIndex = getLastShapeIndex(polyline);
    polyline.setData({ id: idCurrentLine, index: lastIndex });
    addEventBubble(polyline);
    map?.addObject(polyline);
  };

  const handleEndDraw = () => {
    if (lineString.getPointCount() >= 2) {
      map?.getObjects().forEach((obj) => {
        if (
          obj instanceof H.map.Polyline &&
          obj.getData().id === idCurrentLine
        ) {
          map.removeObject(obj);
        }
      });

      if (currentAction === "DRAW_POLYGON" && lineString.getPointCount() > 2) {
        handleDrawPolygon();
      } else if (
        currentAction === "DRAW_LINE" ||
        lineString.getPointCount() <= 2
      ) {
        handleDrawLine();
      }
    }

    handleReset();
  };

  const handlePreviewDraw = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || points.length < 1) return;
    if (ctxRef.current && renderingParamsRef.current) {
      ctxRef.current.clearRect(
        0,
        0,
        renderingParamsRef.current.size.w,
        renderingParamsRef.current.size.h
      );

      const { clientX: viewportX, clientY: viewportY } = e;
      const lastPos = map?.geoToScreen({
        lat: points.at(-1)?.lat || 0,
        lng: points.at(-1)?.lng || 0,
      });
      if (lastPos) {
        ctxRef.current.strokeStyle = "red";
        ctxRef.current.lineWidth = 4;
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(lastPos.x, lastPos.y);
        ctxRef.current.lineTo(viewportX, viewportY);
        ctxRef.current.stroke();
      }
    }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        initMap(lat, lng);
      });
    } else {
      initMap(0, 0);
    }
  }, [initMap]);

  useEffect(() => {
    document.addEventListener("keydown", handleEsc);

    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, [handleEsc]);

  return (
    <div
      onClick={handleDraw}
      onDoubleClick={handleEndDraw}
      onMouseMove={handlePreviewDraw}
      className={clsx(styles.container, [
        isDrawing ? styles.isDrawing : styles.normal,
      ])}
      ref={mapRef as RefObject<HTMLDivElement>}
    >
      <div className={clsx(styles.actions)}>
        {ICONS_MAP.map((icon) => (
          <div
            key={icon.actionType}
            className={clsx(styles[icon.style], {
              [styles.active]: currentAction === icon.actionType,
            })}
            onClick={(e) => handleChangeAction(e, icon.actionType)}
          />
        ))}
      </div>
    </div>
  );
};

export default DisplayMap;
