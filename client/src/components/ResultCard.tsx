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

      <h3>Why {result.setup.direction === "NEUTRAL" ? "No Clear Bias" : `${result.setup.direction} Signal`}</h3>
      <ul>
        {result.setup.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

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
