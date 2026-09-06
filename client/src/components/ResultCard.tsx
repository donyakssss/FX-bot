import type { LiveUpdate } from "../api/live";

type Props = {
  result: LiveUpdate;
};

export default function ResultCard({ result }: Props) {
  return (
    <section className="card result-card">
      <h2>Long-Term Limit Planner</h2>

      {result.setup.futureEntries.length > 0 && (
        <>
          <h3>Primary Limit Placement Plan</h3>
          <div className="future-list">
            {result.setup.futureEntries.map((entry, idx) => (
              <div className="future-item" key={`${entry.orderType}-${idx}`}>
                <p className="label">{entry.orderType} - Layer {idx + 1}</p>
                <p className="mini-note">
                  Entry {entry.entry} | Allocation {entry.allocationPercent}% | Hold {entry.expectedHold}
                </p>
                <p className="mini-note">
                  SL {entry.stopLoss} | TP {entry.takeProfit} | RR 1:{entry.rr}
                </p>
                <p className="mini-note">{entry.rationale}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Current Market Trigger</h3>
      <div className="grid two">
        <div>
          <p className="label">Trade Style</p>
          <p className="value">{result.setup.appliedMode.toUpperCase()}</p>
        </div>
        <div>
          <p className="label">Direction</p>
          <p className={`value direction ${result.setup.direction.toLowerCase()}`}>{result.setup.direction}</p>
        </div>
        <div>
          <p className="label">Confidence</p>
          <p className="value">{Math.round(result.setup.confidence * 100)}%</p>
        </div>
        <div>
          <p className="label">Quality</p>
          <p className="value">{result.setup.signalQuality}</p>
        </div>
        <div>
          <p className="label">Market Shift</p>
          <p className="value">{result.setup.marketShift.significant ? "SIGNIFICANT" : "NOT SIGNIFICANT"}</p>
        </div>
        <div>
          <p className="label">Shift Score</p>
          <p className="value">{result.setup.marketShift.score}</p>
        </div>
        <div>
          <p className="label">Entry</p>
          <p className="value">{result.setup.entry}</p>
        </div>
        <div>
          <p className="label">Stop Loss</p>
          <p className="value">{result.setup.stopLoss}</p>
        </div>
        <div>
          <p className="label">Take Profit</p>
          <p className="value">{result.setup.takeProfit}</p>
        </div>
        <div>
          <p className="label">Risk:Reward</p>
          <p className="value">1:{result.setup.rr}</p>
        </div>
      </div>

      <h3>Risk And Position Size</h3>
      <div className="grid two">
        <div>
          <p className="label">Risk Amount</p>
          <p className="value">${result.risk.riskAmount}</p>
        </div>
        <div>
          <p className="label">Position Size</p>
          <p className="value">{result.risk.lotSize} lots</p>
        </div>
      </div>

      {result.riskControls?.newsBlock && (
        <>
          <h3>Economic Calendar Guard</h3>
          <p className="mini-note">
            {result.riskControls.newsBlock.blocked
              ? `Blocked: ${result.riskControls.newsBlock.reason ?? "High-impact event window active."}`
              : "No active high-impact event block window."}
          </p>
        </>
      )}

      <h3>Why {result.setup.direction === "NEUTRAL" ? "No Clear Bias" : `${result.setup.direction} Signal`}</h3>
      <ul>
        {result.setup.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      {result.setup.fundamentals && (
        <>
          <h3>Fundamental And News Context</h3>
          <p className="mini-note">
            Sentiment: {result.setup.fundamentals.sentimentScore} | Impact: {result.setup.fundamentals.impact}
          </p>
          <div className="future-list">
            {result.setup.fundamentals.headlines.slice(0, 3).map((headline) => (
              <div className="future-item" key={headline.url || headline.title}>
                <p className="label">{headline.source}</p>
                <p className="mini-note">{headline.title}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {result.risk.warnings.length > 0 && (
        <>
          <h3>Warnings</h3>
          <ul>
            {result.risk.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}

      <p className="notice">Live feed updates every 5 seconds.</p>
    </section>
  );
}
