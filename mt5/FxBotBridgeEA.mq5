#property strict
#property version   "1.00"
#property description "FX Bot MT5 Bridge EA: polls pending orders from Node API and places MT5 pending orders."

#include <Trade/Trade.mqh>

input string BridgeBaseUrl = "https://fx-bot-api.onrender.com";
input string SharedSecret = "2aHV4uomWzl/F9F2KGygTIBXRqGGA/LVeE6NWmfsDOE=";
input int PollIntervalSec = 5;
input int RequestTimeoutMs = 5000;
input bool RestrictToCurrentChartSymbol = false;
input int MaxOrdersPerPoll = 5;
input ulong MagicNumber = 20260714;

CTrade trade;

string gTrailSymbols[];
double gTrailEntry[];
double gTrailInitialSl[];
double gTrailBreakEvenR[];
double gTrailStartR[];
double gTrailStepR[];

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
      idx = n;
   }

   gTrailSymbols[idx] = symbol;
   gTrailEntry[idx] = entry;
   gTrailInitialSl[idx] = initialSl;
   gTrailBreakEvenR[idx] = breakEvenR;
   gTrailStartR[idx] = trailStartR;
   gTrailStepR[idx] = trailStepR;
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

      if(posType == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
         double rNow = (bid - entry) / risk;

         if(rNow >= breakEvenR && (currentSl < entry || currentSl == 0.0))
            newSl = entry;

         if(rNow >= startR)
         {
            double candidate = bid - (risk * stepR);
            if(candidate > newSl)
               newSl = candidate;
         }
      }
      else if(posType == POSITION_TYPE_SELL)
      {
         double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
         double rNow = (entry - ask) / risk;

         if(rNow >= breakEvenR && (currentSl > entry || currentSl == 0.0))
            newSl = entry;

         if(rNow >= startR)
         {
            double candidate = ask + (risk * stepR);
            if(newSl == 0.0 || candidate < newSl)
               newSl = candidate;
         }
      }

      if(newSl != currentSl && newSl > 0.0)
      {
         if(!trade.PositionModify(symbol, NormalizeDouble(newSl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)), tp))
            Print("Trailing modify failed on ", symbol, " err=", GetLastError());
      }
   }
}

string BuildHeaders()
{
   string headers = "Content-Type: application/json\r\n";
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
      Print("WebRequest GET failed. Error=", GetLastError(), " URL=", url);
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

bool HttpGet(const string url, string &response)
{
   char data[];
   char result[];
   string resultHeaders = "";
   string headers = BuildHeaders();

   int code = WebRequest("GET", url, headers, RequestTimeoutMs, data, result, resultHeaders);
   if(code == -1)
   {
      Print("WebRequest GET failed. Error=", GetLastError(), " URL=", url);
      return false;
   }

   response = CharArrayToString(result, 0, ArraySize(result));
   if(code < 200 || code >= 300)
   {
      Print("WebRequest GET non-2xx. Code=", code, " Body=", response);
      return false;
   }

   return true;
}

bool HttpPost(const string url, const string body, string &response)
{
   char data[];
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);

   char result[];
   string resultHeaders = "";
   string headers = BuildHeaders();

   int code = WebRequest("POST", url, headers, RequestTimeoutMs, data, result, resultHeaders);
   if(code == -1)
   {
      Print("WebRequest POST failed. Error=", GetLastError(), " URL=", url);
      return false;
   }

   response = CharArrayToString(result, 0, ArraySize(result));
   if(code < 200 || code >= 300)
   {
      Print("WebRequest POST non-2xx. Code=", code, " Body=", response);
      return false;
   }

   return true;
}

void AckOrder(const string id, const string status, const string ticket, const string note)
{
   string url = BridgeBaseUrl + "/api/mt5/orders/ack";
   string body = "{";
   body += "\"id\":\"" + JsonEscape(id) + "\",";
   body += "\"status\":\"" + JsonEscape(status) + "\",";
   body += "\"ticket\":\"" + JsonEscape(ticket) + "\",";
   body += "\"note\":\"" + JsonEscape(note) + "\"";
   body += "}";

   string response = "";
   if(!HttpPost(url, body, response))
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

   if(!SymbolSelect(brokerSymbol, true))
   {
      AckOrder(id, "REJECTED", "", "Symbol not available in Market Watch");
      return false;
   }

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_PENDING;
   req.symbol = brokerSymbol;
   req.volume = lotSize;
   req.magic = MagicNumber;
   req.deviation = 10;
   req.type_time = ORDER_TIME_GTC;
   req.type_filling = ORDER_FILLING_RETURN;

   if(orderType == "BUY_LIMIT")
      req.type = ORDER_TYPE_BUY_LIMIT;
   else if(orderType == "SELL_LIMIT")
      req.type = ORDER_TYPE_SELL_LIMIT;
   else
   {
      AckOrder(id, "REJECTED", "", "Unsupported orderType");
      return false;
   }

   req.price = NormalizeDouble(entry, (int)SymbolInfoInteger(brokerSymbol, SYMBOL_DIGITS));
   req.sl = stopLoss;
   req.tp = takeProfit;
   req.comment = "FXB:" + StringSubstr(id, 0, 8);

   bool sent = OrderSend(req, res);
   if(!sent || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
   {
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
   string url = BridgeBaseUrl + "/api/mt5/orders/pending";
   string response = "";

   if(!HttpGet(url, response))
      return;

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
   trade.SetExpertMagicNumber(MagicNumber);
   EventSetTimer(PollIntervalSec);
   Print("FX Bot Bridge EA initialized. Poll interval=", PollIntervalSec, "s");
   Print("Remember to allow WebRequest URL: ", BridgeBaseUrl);
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
