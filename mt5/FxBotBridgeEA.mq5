#property strict
#property version   "1.03"
#property description "FX Bot MT5 Bridge EA: polls pending orders from Node API and places MT5 pending orders."

#include <Trade/Trade.mqh>

input string BridgeBaseUrl = "https://fx-bot-api.onrender.com";
input string SharedSecret = "2aHV4uomWzl/F9F2KGygTIBXRqGGA/LVeE6NWmfsDOE=";
input int PollIntervalSec = 5;
input int RequestTimeoutMs = 15000;
input bool RestrictToCurrentChartSymbol = false;
input int MaxOrdersPerPoll = 5;
input ulong MagicNumber = 20260714;
input bool AutoLotByAccountRisk = true;
input double RiskPercentPerTrade = 1.0;
input bool EnablePartialClose = true;
input double PartialCloseAtR = 1.0;
input double PartialClosePercent = 50.0;
input bool EnableThreatExit = true;
input double ThreatExitR = -0.75;
input bool EnforceLocalPositionLimits = false;
input int MaxOpenPositionsByMagic = 3;
input int MaxOpenPositionsPerSymbol = 1;
input int MaxPendingOrdersByMagic = 5;
input int MaxPendingOrdersPerSymbol = 2;

CTrade trade;
string gBridgeBaseUrl = "";

string gTrailSymbols[];
double gTrailEntry[];
double gTrailInitialSl[];
double gTrailBreakEvenR[];
double gTrailStartR[];
double gTrailStepR[];
bool gPartialTaken[];

int FindTrailIndex(const string symbol)
{
   for(int i = 0; i < ArraySize(gTrailSymbols); i++)
   {
      if(gTrailSymbols[i] == symbol)
         return i;
   }
   return -1;
}

void UpsertTrailContext(const string symbol, const double entry, const double initialSl, const double breakEvenR, const double trailStartR, const double trailStepR)
{
   int idx = FindTrailIndex(symbol);
   if(idx < 0)
   {
      int n = ArraySize(gTrailSymbols);
      ArrayResize(gTrailSymbols, n + 1);
      ArrayResize(gTrailEntry, n + 1);
      ArrayResize(gTrailInitialSl, n + 1);
      ArrayResize(gTrailBreakEvenR, n + 1);
      ArrayResize(gTrailStartR, n + 1);
      ArrayResize(gTrailStepR, n + 1);
      ArrayResize(gPartialTaken, n + 1);
      idx = n;
   }

   gTrailSymbols[idx] = symbol;
   gTrailEntry[idx] = entry;
   gTrailInitialSl[idx] = initialSl;
   gTrailBreakEvenR[idx] = breakEvenR;
   gTrailStartR[idx] = trailStartR;
   gTrailStepR[idx] = trailStepR;
   gPartialTaken[idx] = false;
}

double NormalizeVolume(const string symbol, const double volume)
{
   double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   if(step <= 0.0)
      return MathMax(minVol, MathMin(maxVol, volume));

   double rounded = MathFloor(volume / step) * step;
   rounded = MathMax(minVol, MathMin(maxVol, rounded));
   int volumeDigits = 2;
   return NormalizeDouble(rounded, volumeDigits);
}

double ComputeRiskBasedVolume(const string symbol, const bool isBuy, const double entry, const double stopLoss, const double fallbackVolume)
{
   if(!AutoLotByAccountRisk)
      return NormalizeVolume(symbol, fallbackVolume);

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * (RiskPercentPerTrade / 100.0);

   if(riskAmount <= 0.0 || entry <= 0.0 || stopLoss <= 0.0 || MathAbs(entry - stopLoss) <= 0.0)
      return NormalizeVolume(symbol, fallbackVolume);

   double oneLotProfit = 0.0;
   ENUM_ORDER_TYPE side = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcProfit(side, symbol, 1.0, entry, stopLoss, oneLotProfit))
      return NormalizeVolume(symbol, fallbackVolume);

   double lossPerLotAtStop = MathAbs(oneLotProfit);
   if(lossPerLotAtStop <= 0.0)
      return NormalizeVolume(symbol, fallbackVolume);

   double rawVolume = riskAmount / lossPerLotAtStop;
   return NormalizeVolume(symbol, rawVolume);
}

int CountOpenPositionsByMagicAndSymbol(const string symbol)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) != MagicNumber)
         continue;

      if(PositionGetString(POSITION_SYMBOL) == symbol)
         count++;
   }

   return count;
}

int CountOpenPositionsByMagic()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         count++;
   }

   return count;
}

int CountPendingOrdersByMagicAndSymbol(const string symbol)
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
         continue;

      if((ulong)OrderGetInteger(ORDER_MAGIC) != MagicNumber)
         continue;

      if(OrderGetString(ORDER_SYMBOL) == symbol)
         count++;
   }

   return count;
}

int CountPendingOrdersByMagic()
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
         continue;

      if((ulong)OrderGetInteger(ORDER_MAGIC) == MagicNumber)
         count++;
   }

   return count;
}

bool IsLocalPositionLimitReached(const string symbol)
{
   if(!EnforceLocalPositionLimits)
      return false;

   if(MaxOpenPositionsByMagic > 0 && CountOpenPositionsByMagic() >= MaxOpenPositionsByMagic)
      return true;

   if(MaxOpenPositionsPerSymbol > 0 && CountOpenPositionsByMagicAndSymbol(symbol) >= MaxOpenPositionsPerSymbol)
      return true;

   if(MaxPendingOrdersByMagic > 0 && CountPendingOrdersByMagic() >= MaxPendingOrdersByMagic)
      return true;

   if(MaxPendingOrdersPerSymbol > 0 && CountPendingOrdersByMagicAndSymbol(symbol) >= MaxPendingOrdersPerSymbol)
      return true;

   return false;
}

bool CheckTradingAllowed(const string symbol, string &reason)
{
   reason = "";

   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      reason = "Terminal is offline";
      return false;
   }

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
   {
      reason = "Terminal AutoTrading is OFF";
      return false;
   }

   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      reason = "EA setting 'Allow Algo Trading' is OFF";
      return false;
   }

   if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      reason = "Account trading is disabled (investor/read-only or broker-restricted)";
      return false;
   }

   if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
   {
      reason = "Account blocks expert trading";
      return false;
   }

   return true;
}

bool IsSymbolTradableForSide(const string symbol, const bool isBuy, string &reason)
{
   reason = "";
   ENUM_SYMBOL_TRADE_MODE tradeMode = (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);

   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED)
   {
      reason = "Symbol trade mode is disabled by broker";
      return false;
   }

   if(tradeMode == SYMBOL_TRADE_MODE_CLOSEONLY)
   {
      reason = "Symbol is close-only";
      return false;
   }

   if(isBuy && tradeMode == SYMBOL_TRADE_MODE_SHORTONLY)
   {
      reason = "Symbol allows sell only";
      return false;
   }

   if(!isBuy && tradeMode == SYMBOL_TRADE_MODE_LONGONLY)
   {
      reason = "Symbol allows buy only";
      return false;
   }

   return true;
}

bool IsSymbolCompatible(const string baseSymbol, const string brokerSymbol)
{
   string baseKey = NormalizeSymbolKey(baseSymbol);
   string brokerKey = NormalizeSymbolKey(brokerSymbol);

   if(baseKey == "" || brokerKey == "")
      return false;

   if(StringFind(brokerKey, baseKey) >= 0)
      return true;

   if(StringFind(baseKey, brokerKey) >= 0)
      return true;

   return false;
}

bool IsOrderPriceSaneForSymbol(const string brokerSymbol, const double entry, string &reason)
{
   reason = "";
   double bid = SymbolInfoDouble(brokerSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(brokerSymbol, SYMBOL_ASK);
   double ref = (bid > 0.0 && ask > 0.0) ? ((bid + ask) * 0.5) : (bid > 0.0 ? bid : ask);

   if(entry <= 0.0 || ref <= 0.0)
      return true;

   double ratio = entry / ref;
   if(ratio < 0.2 || ratio > 5.0)
   {
      reason = "Entry price is incompatible with symbol market price";
      return false;
   }

   return true;
}

void ApplyTrailingForAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      if((ulong)PositionGetInteger(POSITION_MAGIC) != MagicNumber)
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      int idx = FindTrailIndex(symbol);
      if(idx < 0)
         continue;

      double entry = gTrailEntry[idx];
      double initialSl = gTrailInitialSl[idx];
      double risk = MathAbs(entry - initialSl);
      if(risk <= 0)
         continue;

      int posType = (int)PositionGetInteger(POSITION_TYPE);
      double currentSl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double breakEvenR = gTrailBreakEvenR[idx];
      double startR = gTrailStartR[idx];
      double stepR = gTrailStepR[idx];
      double newSl = currentSl;
      double rNow = 0.0;
      double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
      double minDistance = MinStopDistance(symbol);
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

      if(posType == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
         rNow = (bid - entry) / risk;

         if(rNow >= breakEvenR && (currentSl < entry || currentSl == 0.0))
            newSl = entry;

         if(rNow >= startR)
         {
            double candidate = bid - (risk * stepR);
            if(candidate > newSl)
               newSl = candidate;
         }

         if(newSl > 0.0)
            newSl = MathMin(newSl, bid - minDistance);
      }
      else if(posType == POSITION_TYPE_SELL)
      {
         double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
         rNow = (entry - ask) / risk;

         if(rNow >= breakEvenR && (currentSl > entry || currentSl == 0.0))
            newSl = entry;

         if(rNow >= startR)
         {
            double candidate = ask + (risk * stepR);
            if(newSl == 0.0 || candidate < newSl)
               newSl = candidate;
         }

         if(newSl > 0.0)
            newSl = MathMax(newSl, ask + minDistance);
      }

      if(EnablePartialClose && !gPartialTaken[idx] && rNow >= PartialCloseAtR)
      {
         double currentVolume = PositionGetDouble(POSITION_VOLUME);
         double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
         double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
         double closeVolume = currentVolume * (PartialClosePercent / 100.0);
         closeVolume = NormalizeVolume(symbol, closeVolume);

         if(closeVolume >= minVol && (currentVolume - closeVolume) >= minVol)
         {
            if(trade.PositionClosePartial(ticket, closeVolume))
            {
               gPartialTaken[idx] = true;
               Print("Partial close executed. Symbol=", symbol, " ClosedLots=", closeVolume, " Remaining=", PositionGetDouble(POSITION_VOLUME));
            }
            else
            {
               Print("Partial close failed. Symbol=", symbol, " Retcode=", trade.ResultRetcode());
            }
         }
      }

      if(EnableThreatExit && ThreatExitR < 0.0 && rNow <= ThreatExitR)
      {
         if(trade.PositionClose(ticket))
         {
            Print("Threat exit executed before full SL. Symbol=", symbol, " RNow=", rNow, " Threshold=", ThreatExitR);
            continue;
         }

         Print("Threat exit failed. Symbol=", symbol, " Retcode=", trade.ResultRetcode());
      }

      if(newSl > 0.0)
      {
         newSl = NormalizeDouble(newSl, digits);

         // Skip no-op trailing updates to avoid retcode/no-change spam.
         if(currentSl > 0.0 && MathAbs(newSl - currentSl) <= (point * 0.5))
            continue;

         if(!trade.PositionModify(symbol, newSl, tp))
         {
            int ret = (int)trade.ResultRetcode();
            if(ret != TRADE_RETCODE_NO_CHANGES)
               Print("Trailing modify failed on ", symbol, " retcode=", ret, " err=", GetLastError());
         }
      }
   }
}

string NormalizeBaseUrl(const string url)
{
   string out = url;
   while(StringLen(out) > 0 && StringGetCharacter(out, StringLen(out) - 1) == '/')
      out = StringSubstr(out, 0, StringLen(out) - 1);
   return out;
}

string BuildHeaders(const bool includeJsonContentType)
{
   string headers = "Accept: application/json\r\n";
   if(includeJsonContentType)
      headers += "Content-Type: application/json\r\n";

   if(StringLen(SharedSecret) > 0)
      headers += "x-mt5-secret: " + SharedSecret + "\r\n";
   return headers;
}

string JsonEscape(const string value)
{
   string v = value;
   StringReplace(v, "\\", "\\\\");
   StringReplace(v, "\"", "\\\"");
   return v;
}

string UrlEncode(const string value)
{
   string encoded = value;
   StringReplace(encoded, "%", "%25");
   StringReplace(encoded, " ", "%20");
   StringReplace(encoded, "?", "%3F");
   StringReplace(encoded, "&", "%26");
   StringReplace(encoded, "=", "%3D");
   StringReplace(encoded, "+", "%2B");
   StringReplace(encoded, "#", "%23");
   StringReplace(encoded, "/", "%2F");
   StringReplace(encoded, "\"", "%22");
   StringReplace(encoded, "\r", "%0D");
   StringReplace(encoded, "\n", "%0A");
   return encoded;
}

string NormalizeSymbolKey(const string symbol)
{
   string normalized = "";
   for(int i = 0; i < StringLen(symbol); i++)
   {
      ushort ch = (ushort)StringGetCharacter(symbol, i);
      if((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
      {
         string single = CharToString(ch);
         normalized += StringToLower(single);
      }
   }

   return normalized;
}

string ResolveBrokerSymbol(const string preferredSymbol, const string baseSymbol, const bool isBuy)
{
   string exact[] = {preferredSymbol, baseSymbol};
   for(int i = 0; i < ArraySize(exact); i++)
   {
      string candidate = exact[i];
      if(candidate == "")
         continue;
      string sideReason = "";
      if(SymbolSelect(candidate, true) && IsSymbolTradableForSide(candidate, isBuy, sideReason))
         return candidate;
   }

   string requestedKey = NormalizeSymbolKey(baseSymbol);
   int total = SymbolsTotal(true);
   for(int i = 0; i < total; i++)
   {
      string marketSymbol = SymbolName(i, true);
      if(marketSymbol == "")
         continue;

      string marketKey = NormalizeSymbolKey(marketSymbol);
      if(StringFind(marketKey, requestedKey) >= 0 || StringFind(requestedKey, marketKey) >= 0)
      {
         string sideReason = "";
         if(SymbolSelect(marketSymbol, true) && IsSymbolTradableForSide(marketSymbol, isBuy, sideReason))
            return marketSymbol;
      }
   }

   return baseSymbol;
}

string BuildMt5Url(const string path)
{
   string url = gBridgeBaseUrl + path;
   if(StringLen(SharedSecret) > 0)
   {
      url += (StringFind(url, "?") >= 0 ? "&" : "?") + "mt5Secret=" + UrlEncode(SharedSecret);
   }
   return url;
}

string ExtractJsonValue(const string obj, const string key)
{
   string token = "\"" + key + "\":";
   int start = StringFind(obj, token);
   if(start < 0)
      return "";

   int pos = start + StringLen(token);
   int len = StringLen(obj);
   while(pos < len && (StringGetCharacter(obj, pos) == ' ' || StringGetCharacter(obj, pos) == '\t'))
      pos++;

   if(pos >= len)
      return "";

   ushort first = (ushort)StringGetCharacter(obj, pos);
   if(first == '"')
   {
      pos++;
      int end = StringFind(obj, "\"", pos);
      if(end < 0)
         return "";
      return StringSubstr(obj, pos, end - pos);
   }

   int endPos = pos;
   while(endPos < len)
   {
      ushort c = (ushort)StringGetCharacter(obj, endPos);
      if(c == ',' || c == '}' || c == '\r' || c == '\n')
         break;
      endPos++;
   }

   string raw = StringSubstr(obj, pos, endPos - pos);
   StringReplace(raw, " ", "");
   StringReplace(raw, "\t", "");
   StringReplace(raw, "\r", "");
   StringReplace(raw, "\n", "");
   return raw;
}

bool ParseOrders(const string response, string &orderObjects[])
{
   ArrayResize(orderObjects, 0);

   int arrStart = StringFind(response, "[", 0);
   int arrEnd = StringFind(response, "]", arrStart);
   if(arrStart < 0 || arrEnd < 0 || arrEnd <= arrStart)
      return false;

   string arr = StringSubstr(response, arrStart + 1, arrEnd - arrStart - 1);
   if(StringLen(arr) < 2)
      return true;

   int level = 0;
   int objStart = -1;

   for(int i = 0; i < StringLen(arr); i++)
   {
      ushort ch = (ushort)StringGetCharacter(arr, i);
      if(ch == '{')
      {
         if(level == 0)
            objStart = i;
         level++;
      }
      else if(ch == '}')
      {
         level--;
         if(level == 0 && objStart >= 0)
         {
            string obj = StringSubstr(arr, objStart, i - objStart + 1);
            int n = ArraySize(orderObjects);
            ArrayResize(orderObjects, n + 1);
            orderObjects[n] = obj;
            objStart = -1;
         }
      }
   }

   return true;
}

double NormalizePrice(const string symbol, const double price)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   return NormalizeDouble(price, digits);
}

double MinStopDistance(const string symbol)
{
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int stopsLevel = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   return MathMax(point * stopsLevel, point * 10.0);
}

void EnsureStopsForOrder(
   const string symbol,
   const bool isBuy,
   const double referencePrice,
   double &stopLoss,
   double &takeProfit
)
{
   double minDistance = MinStopDistance(symbol);

   if(isBuy)
   {
      if(stopLoss <= 0.0 || stopLoss >= (referencePrice - minDistance))
         stopLoss = referencePrice - (minDistance * 1.5);

      if(takeProfit <= 0.0 || takeProfit <= (referencePrice + minDistance))
         takeProfit = referencePrice + (minDistance * 2.0);
   }
   else
   {
      if(stopLoss <= 0.0 || stopLoss <= (referencePrice + minDistance))
         stopLoss = referencePrice + (minDistance * 1.5);

      if(takeProfit <= 0.0 || takeProfit >= (referencePrice - minDistance))
         takeProfit = referencePrice - (minDistance * 2.0);
   }

   stopLoss = NormalizePrice(symbol, stopLoss);
   takeProfit = NormalizePrice(symbol, takeProfit);
}

bool ExecuteMarketFallback(const string brokerSymbol, const string orderType, const double lotSize, const double stopLoss, const double takeProfit, const string id)
{
   string tradeReason = "";
   if(!CheckTradingAllowed(brokerSymbol, tradeReason))
   {
      Print("Market fallback blocked before send. Symbol=", brokerSymbol, " Reason=", tradeReason);
      return false;
   }

   if(IsLocalPositionLimitReached(brokerSymbol))
   {
      Print("Local position limit reached for ", brokerSymbol, ". Market fallback skipped.");
      return false;
   }

   string comment = "FXB:" + StringSubstr(id, 0, 8) + ":MKT";
   bool ok = false;
   bool isBuy = (orderType == "BUY_LIMIT" || orderType == "BUY_MARKET");
   double bid = SymbolInfoDouble(brokerSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(brokerSymbol, SYMBOL_ASK);
   double marketPrice = isBuy ? ask : bid;
   double stopReferencePrice = ask;
   double adjustedSl = stopLoss;
   double adjustedTp = takeProfit;
   double tradeVolume = ComputeRiskBasedVolume(brokerSymbol, isBuy, marketPrice, adjustedSl, lotSize);

   EnsureStopsForOrder(brokerSymbol, isBuy, stopReferencePrice, adjustedSl, adjustedTp);

   Print("Market fallback normalized stops. Symbol=", brokerSymbol, " Side=", (isBuy ? "BUY" : "SELL"), " Bid=", bid, " Ask=", ask, " SL=", adjustedSl, " TP=", adjustedTp, " Volume=", tradeVolume);

   if(isBuy)
   {
      ok = trade.Buy(tradeVolume, brokerSymbol, 0.0, adjustedSl, adjustedTp, comment);
   }
   else
   {
      ok = trade.Sell(tradeVolume, brokerSymbol, 0.0, adjustedSl, adjustedTp, comment);
   }

   if(!ok)
   {
      Print("Market fallback failed. Retcode=", trade.ResultRetcode(), " Desc=", trade.ResultRetcodeDescription(), " Symbol=", brokerSymbol, " Type=", orderType);
      return false;
   }

   Print("Market fallback executed. Order=", trade.ResultOrder(), " Deal=", trade.ResultDeal(), " Symbol=", brokerSymbol);
   return true;
}

bool HttpGet(const string url, string &response)
{
   char data[];
   char result[];
   string resultHeaders = "";
   string headers = BuildHeaders(false);

   int code = WebRequest("GET", url, headers, RequestTimeoutMs, data, result, resultHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      Print("WebRequest GET failed. Error=", err, " URL=", url);
      return false;
   }

   response = CharArrayToString(result, 0, ArraySize(result));

   // MT5 occasionally reports non-HTTP transport/protocol values (>=1000) instead of standard HTTP status.
   // Treat these as transient request failures and continue with the health fallback path.
   if(code >= 1000)
   {
      Print("WebRequest GET transport/protocol status. Code=", code, " URL=", url, " Headers=", resultHeaders, " Body=", response);
      return false;
   }

   if(code < 200 || code >= 300)
   {
      Print("WebRequest GET response headers: ", resultHeaders);
      Print("WebRequest GET non-2xx. Code=", code, " URL=", url, " Body=", response);
      return false;
   }

   return true;
}

bool HttpPost(const string url, const string body, string &response)
{
   char data[];
   int bodyLen = StringLen(body);
   ArrayResize(data, bodyLen);
   StringToCharArray(body, data, 0, bodyLen, CP_UTF8);

   char result[];
   string resultHeaders = "";
   string headers = BuildHeaders(true);

   int code = WebRequest("POST", url, headers, RequestTimeoutMs, data, result, resultHeaders);
   if(code == -1)
   {
      Print("WebRequest POST failed. Error=", GetLastError(), " URL=", url);
      return false;
   }

   response = CharArrayToString(result, 0, ArraySize(result));
   Print("HTTP Status = ", code);
   Print("Headers = ", resultHeaders);
   Print("Body = ", response);

if(code < 200 || code >= 300)
{
   Print("POST FAILED");
   return false;
}

   return true;
}

void AckOrder(const string id, const string status, const string ticket, const string note)
{
   string url = BuildMt5Url("/api/mt5/orders/ack");
   url += "&id=" + UrlEncode(id);
   url += "&status=" + UrlEncode(status);
   url += "&ticket=" + UrlEncode(ticket);
   url += "&note=" + UrlEncode(note);

   string response = "";
   if(!HttpGet(url, response))
      Print("Ack failed for order id=", id, " status=", status);
}

bool PlacePendingOrder(const string obj)
{
   string id = ExtractJsonValue(obj, "id");
   string symbol = ExtractJsonValue(obj, "symbol");
   string brokerSymbol = ExtractJsonValue(obj, "brokerSymbol");
   string orderType = ExtractJsonValue(obj, "orderType");

   double entry = StringToDouble(ExtractJsonValue(obj, "entry"));
   double stopLoss = StringToDouble(ExtractJsonValue(obj, "stopLoss"));
   double takeProfit = StringToDouble(ExtractJsonValue(obj, "takeProfit"));
   double lotSize = StringToDouble(ExtractJsonValue(obj, "lotSize"));
   double breakEvenR = StringToDouble(ExtractJsonValue(obj, "breakEvenR"));
   double trailStartR = StringToDouble(ExtractJsonValue(obj, "trailStartR"));
   double trailStepR = StringToDouble(ExtractJsonValue(obj, "trailStepR"));
   double adjustedStopLoss = stopLoss;
   double adjustedTakeProfit = takeProfit;
   double tradeVolume = lotSize;

   if(brokerSymbol == "")
      brokerSymbol = symbol;

   if(id == "" || symbol == "" || orderType == "")
   {
      AckOrder(id, "REJECTED", "", "Missing required order fields");
      return false;
   }

   if(RestrictToCurrentChartSymbol && brokerSymbol != _Symbol)
   {
      AckOrder(id, "REJECTED", "", "Symbol not allowed on this chart");
      return false;
   }

   bool isBuyOrder = (orderType == "BUY_LIMIT" || orderType == "BUY_MARKET");
   bool isMarketOrder = (orderType == "BUY_MARKET" || orderType == "SELL_MARKET");

   if(
      orderType != "BUY_LIMIT" &&
      orderType != "SELL_LIMIT" &&
      orderType != "BUY_MARKET" &&
      orderType != "SELL_MARKET"
   )
   {
      AckOrder(id, "REJECTED", "", "Unsupported orderType");
      return false;
   }

   if(!IsSymbolCompatible(symbol, brokerSymbol))
   {
      string previous = brokerSymbol;
      brokerSymbol = ResolveBrokerSymbol(symbol, symbol, isBuyOrder);
      Print("Incompatible broker symbol from queue. Base=", symbol, " Provided=", previous, " Resolved=", brokerSymbol);
   }

   if(!SymbolSelect(brokerSymbol, true))
   {
      brokerSymbol = ResolveBrokerSymbol(brokerSymbol, symbol, isBuyOrder);
      if(!SymbolSelect(brokerSymbol, true))
      {
         AckOrder(id, "REJECTED", "", "Symbol not available in Market Watch");
         return false;
      }
   }

   string sideReason = "";
   if(!IsSymbolTradableForSide(brokerSymbol, isBuyOrder, sideReason))
   {
      string previous = brokerSymbol;
      brokerSymbol = ResolveBrokerSymbol(brokerSymbol, symbol, isBuyOrder);
      if(previous != brokerSymbol)
         Print("Resolved alternate tradable symbol. From=", previous, " To=", brokerSymbol);

      if(!IsSymbolTradableForSide(brokerSymbol, isBuyOrder, sideReason))
      {
         AckOrder(id, "REJECTED", "", sideReason + ". Symbol=" + brokerSymbol);
         return false;
      }
   }

   if(!isMarketOrder)
   {
      string priceReason = "";
      if(!IsOrderPriceSaneForSymbol(brokerSymbol, entry, priceReason))
      {
         string msg = priceReason + ". Base=" + symbol + " Broker=" + brokerSymbol + " Entry=" + DoubleToString(entry, 6);
         AckOrder(id, "REJECTED", "", msg);
         Print("Order blocked by price sanity check. ", msg);
         return false;
      }
   }

   if(IsLocalPositionLimitReached(brokerSymbol))
   {
      AckOrder(id, "REJECTED", "", "Local position limit reached before order send");
      return false;
   }

   string tradeReason = "";
   if(!CheckTradingAllowed(brokerSymbol, tradeReason))
   {
      AckOrder(id, "REJECTED", "", tradeReason);
      Print("Order blocked before send. Symbol=", brokerSymbol, " Reason=", tradeReason);
      return false;
   }

   if(isMarketOrder)
   {
      if(ExecuteMarketFallback(brokerSymbol, orderType, lotSize, stopLoss, takeProfit, id))
      {
         if(breakEvenR <= 0.0)
            breakEvenR = 1.0;
         if(trailStartR <= 0.0)
            trailStartR = 1.6;
         if(trailStepR <= 0.0)
            trailStepR = 0.8;

         double marketEntry = isBuyOrder ? SymbolInfoDouble(brokerSymbol, SYMBOL_ASK) : SymbolInfoDouble(brokerSymbol, SYMBOL_BID);
         UpsertTrailContext(brokerSymbol, marketEntry, stopLoss, breakEvenR, trailStartR, trailStepR);
         AckOrder(id, "FILLED", IntegerToString((int)trade.ResultOrder()), "Market order executed");
         return true;
      }

      string marketMsg = "Market order failed. Retcode=" + IntegerToString((int)trade.ResultRetcode());
      AckOrder(id, "REJECTED", "", marketMsg);
      return false;
   }

   double bid = SymbolInfoDouble(brokerSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(brokerSymbol, SYMBOL_ASK);
   double point = SymbolInfoDouble(brokerSymbol, SYMBOL_POINT);
   int stopsLevel = (int)SymbolInfoInteger(brokerSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDistance = MathMax(point * stopsLevel, point * 5.0);
   bool validPending = true;

   if(orderType == "BUY_LIMIT")
   {
      validPending = entry < (ask - minDistance);
      EnsureStopsForOrder(brokerSymbol, true, entry, adjustedStopLoss, adjustedTakeProfit);
      tradeVolume = ComputeRiskBasedVolume(brokerSymbol, true, entry, adjustedStopLoss, lotSize);
   }
   else if(orderType == "SELL_LIMIT")
   {
      validPending = entry > (bid + minDistance);
      EnsureStopsForOrder(brokerSymbol, false, entry, adjustedStopLoss, adjustedTakeProfit);
      tradeVolume = ComputeRiskBasedVolume(brokerSymbol, false, entry, adjustedStopLoss, lotSize);
   }

   if(!validPending)
   {
      Print("Pending entry invalid for ", brokerSymbol, ". Switching to market order. Entry=", entry, " Bid=", bid, " Ask=", ask, " MinDistance=", minDistance);
      if(ExecuteMarketFallback(brokerSymbol, orderType, lotSize, stopLoss, takeProfit, id))
      {
         AckOrder(id, "FILLED", IntegerToString((int)trade.ResultOrder()), "Order executed as market fallback because pending entry was invalid");
         return true;
      }

      string fallbackMsg = "Market fallback failed after invalid pending entry. Retcode=" + IntegerToString((int)trade.ResultRetcode());
      AckOrder(id, "REJECTED", "", fallbackMsg);
      return false;
   }

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_PENDING;
   req.symbol = brokerSymbol;
   req.volume = tradeVolume;
   req.magic = MagicNumber;
   req.deviation = 10;
   req.type_time = ORDER_TIME_GTC;
   req.type_filling = ORDER_FILLING_RETURN;

   if(orderType == "BUY_LIMIT")
      req.type = ORDER_TYPE_BUY_LIMIT;
   else if(orderType == "SELL_LIMIT")
      req.type = ORDER_TYPE_SELL_LIMIT;

   req.price = NormalizeDouble(entry, (int)SymbolInfoInteger(brokerSymbol, SYMBOL_DIGITS));
   req.sl = adjustedStopLoss;
   req.tp = adjustedTakeProfit;
   req.comment = "FXB:" + StringSubstr(id, 0, 8);

   bool sent = OrderSend(req, res);
   if(!sent || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
   {
      if(res.retcode == 10033 || res.retcode == 10040)
      {
         Print("Pending order rejected by broker limit. Switching to market fallback for ", brokerSymbol, " retcode=", (int)res.retcode);
         if(ExecuteMarketFallback(brokerSymbol, orderType, lotSize, stopLoss, takeProfit, id))
         {
            AckOrder(id, "FILLED", IntegerToString((int)trade.ResultOrder()), "Market fallback after pending-order limit");
            return true;
         }
      }

      if(res.retcode == 10017)
      {
         string disabledReason = "";
         if(CheckTradingAllowed(brokerSymbol, disabledReason))
            disabledReason = "Broker returned trade disabled (symbol session/state restriction)";

         string disabledMsg = "Trade disabled: " + disabledReason;
         AckOrder(id, "REJECTED", "", disabledMsg);
         Print("OrderSend failed. Retcode=10017 symbol=", brokerSymbol, " reason=", disabledReason);
         return false;
      }

      string msg = "OrderSend failed. Retcode=" + IntegerToString((int)res.retcode);
      AckOrder(id, "REJECTED", "", msg);
      Print(msg, " symbol=", brokerSymbol, " type=", orderType);
      return false;
   }

    if(breakEvenR <= 0.0)
      breakEvenR = 1.0;
   if(trailStartR <= 0.0)
      trailStartR = 1.6;
   if(trailStepR <= 0.0)
      trailStepR = 0.8;

   UpsertTrailContext(brokerSymbol, entry, stopLoss, breakEvenR, trailStartR, trailStepR);

   AckOrder(id, "FILLED", IntegerToString((int)res.order), "Order accepted by MT5");
   Print("Order accepted: id=", id, " symbol=", brokerSymbol, " ticket=", res.order);
   return true;
}

void PollBridge()
{
   string url = BuildMt5Url("/api/mt5/orders/pending");
   url += "&max=" + IntegerToString(MaxOrdersPerPoll);
   url += "&mt5Owner=" + UrlEncode(IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + ":" + _Symbol);
   string response = "";

   if(!HttpGet(url, response))
   {
      string healthResponse = "";
      string healthUrl = gBridgeBaseUrl + "/api/health";
      if(!HttpGet(healthUrl, healthResponse))
         Print("Bridge health check failed too. Verify URL allowlist and internet access. URL=", gBridgeBaseUrl);
      else
         Print("Bridge health endpoint is reachable: ", healthResponse);
      return;
   }

   string orders[];
   if(!ParseOrders(response, orders))
   {
      Print("Could not parse pending orders response.");
      return;
   }

   int maxCount = MathMin(ArraySize(orders), MaxOrdersPerPoll);
   for(int i = 0; i < maxCount; i++)
      PlacePendingOrder(orders[i]);
}

int OnInit()
{
   gBridgeBaseUrl = NormalizeBaseUrl(BridgeBaseUrl);

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(20);
   EventSetTimer(PollIntervalSec);
   Print("FX Bot Bridge EA build=1.03");
   Print("FX Bot Bridge EA initialized. Poll interval=", PollIntervalSec, "s");
   Print("Remember to allow WebRequest URL: ", gBridgeBaseUrl);

   string healthResponse = "";
   if(HttpGet(gBridgeBaseUrl + "/api/health", healthResponse))
      Print("Bridge health on init: ", healthResponse);
   else
      Print("Bridge health check on init failed. URL=", gBridgeBaseUrl + "/api/health");

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   ApplyTrailingForAllPositions();
}

void OnTimer()
{
   PollBridge();
   ApplyTrailingForAllPositions();
}
