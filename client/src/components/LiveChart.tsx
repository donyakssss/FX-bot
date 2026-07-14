import { ColorType, createChart, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Candle, LiveUpdate } from "../api/live";

type Props = {
  candles: Candle[];
  analysis?: LiveUpdate["setup"] | null;
};

export default function LiveChart({ candles, analysis }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Array<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>>>([]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#08141f" },
        textColor: "#d7ebf9"
      },
      grid: {
        vertLines: { color: "rgba(114, 160, 193, 0.2)" },
        horzLines: { color: "rgba(114, 160, 193, 0.2)" }
      },
      width: containerRef.current.clientWidth,
      height: 380,
      rightPriceScale: {
        borderColor: "rgba(163, 198, 223, 0.4)"
      },
      timeScale: {
        borderColor: "rgba(163, 198, 223, 0.4)"
      }
    });

    const series = chart.addCandlestickSeries({
      upColor: "#39c98a",
      downColor: "#f65f60",
      borderVisible: false,
      wickUpColor: "#39c98a",
      wickDownColor: "#f65f60"
    });
    seriesRef.current = series;

    const handleResize = () => {
      if (!containerRef.current) {
        return;
      }
      chart.applyOptions({ width: containerRef.current.clientWidth });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) {
      return;
    }

    seriesRef.current.setData(
      candles.map((c) => ({
        time: (new Date(c.time).getTime() / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }))
    );
  }, [candles]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }

    for (const line of priceLinesRef.current) {
      seriesRef.current.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (!analysis) {
      return;
    }

    priceLinesRef.current.push(
      seriesRef.current.createPriceLine({
        price: analysis.entry,
        color: "#5bc0ff",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Entry"
      })
    );

    priceLinesRef.current.push(
      seriesRef.current.createPriceLine({
        price: analysis.stopLoss,
        color: "#f65f60",
        lineWidth: 2,
        axisLabelVisible: true,
        title: "SL"
      })
    );

    priceLinesRef.current.push(
      seriesRef.current.createPriceLine({
        price: analysis.takeProfit,
        color: "#39c98a",
        lineWidth: 2,
        axisLabelVisible: true,
        title: "TP"
      })
    );

    for (const [index, plan] of analysis.futureEntries.entries()) {
      priceLinesRef.current.push(
        seriesRef.current.createPriceLine({
          price: plan.entry,
          color: "#f2c94c",
          lineWidth: 2,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `Limit ${index + 1}`
        })
      );
    }
  }, [analysis]);

  return <div className="chart-wrap" ref={containerRef} />;
}
