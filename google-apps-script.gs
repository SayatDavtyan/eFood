const SPREADSHEET_ID = '1IYyESeES-Y3eswklPwlYCJ-UJh-06d3RWES0o_fVKLI';
const ORDERS_SHEET_GID = 0;
const WEBHOOK_SECRET = 'REPLACE_WITH_YOUR_EXISTING_SECRET';
const SHEETS = { invoices: 'Фактуры', recipes: 'Рецептуры', usage: 'Расход', stock: 'Остатки', movements: 'Движение склада' };

const DEFAULT_RECIPES = {
  'Cheeseburger with Salad': [['Булочка',1,'шт'],['Говяжья котлета',150,'г'],['Сыр чеддер',30,'г'],['Салат айсберг',35,'г'],['Помидоры',40,'г'],['Соус бургер',25,'г']],
  'Classic Beef Burger': [['Булочка',1,'шт'],['Говяжья котлета',160,'г'],['Лук',25,'г'],['Огурцы маринованные',25,'г'],['Кетчуп',20,'г'],['Горчица',10,'г']],
  'Royal Cheeseburger': [['Булочка',1,'шт'],['Говяжья котлета',200,'г'],['Сыр чеддер',50,'г'],['Бекон',35,'г'],['Лук',25,'г'],['Соус бургер',30,'г']],
  'Black Angus Burger': [['Булочка',1,'шт'],['Говядина Black Angus',180,'г'],['Сыр чеддер',35,'г'],['Лук карамелизованный',45,'г'],['Салат айсберг',25,'г'],['Соус BBQ',25,'г']],
  'Crispy Chicken Burger': [['Булочка',1,'шт'],['Куриное филе',170,'г'],['Панировка',35,'г'],['Салат айсберг',35,'г'],['Огурцы маринованные',25,'г'],['Майонез',25,'г']],
  'Margherita Pizza': [['Тесто для пиццы',300,'г'],['Томатный соус',90,'г'],['Моцарелла',140,'г'],['Базилик',8,'г'],['Оливковое масло',10,'мл']],
  'Pepperoni Feast': [['Тесто для пиццы',300,'г'],['Томатный соус',90,'г'],['Моцарелла',130,'г'],['Пепперони',100,'г'],['Орегано',3,'г']],
  'Garden Supreme': [['Тесто для пиццы',300,'г'],['Томатный соус',90,'г'],['Моцарелла',110,'г'],['Шампиньоны',60,'г'],['Перец болгарский',60,'г'],['Помидоры',60,'г'],['Оливки',30,'г']],
  'Cheese Volcano': [['Тесто для пиццы',300,'г'],['Томатный соус',80,'г'],['Моцарелла',120,'г'],['Сыр чеддер',60,'г'],['Горгонзола',40,'г'],['Пармезан',25,'г']],
  'Chicken Deluxe': [['Тесто для пиццы',300,'г'],['Сливочный соус',80,'г'],['Моцарелла',120,'г'],['Куриное филе',140,'г'],['Шампиньоны',50,'г'],['Перец болгарский',40,'г']],
  'Classic Club Sandwich': [['Тостовый хлеб',3,'шт'],['Куриное филе',100,'г'],['Бекон',40,'г'],['Помидоры',50,'г'],['Салат айсберг',30,'г'],['Майонез',25,'г']],
  'Double Stack Sandwich': [['Тостовый хлеб',3,'шт'],['Ветчина',80,'г'],['Индейка',80,'г'],['Сыр чеддер',40,'г'],['Помидоры',40,'г'],['Горчичный соус',25,'г']],
  'Grilled Chicken Panini': [['Хлеб чиабатта',1,'шт'],['Куриное филе',140,'г'],['Моцарелла',50,'г'],['Помидоры',50,'г'],['Соус песто',20,'г']],
  'Fresh Veggie Stack': [['Цельнозерновой хлеб',2,'шт'],['Авокадо',80,'г'],['Помидоры',60,'г'],['Огурцы',50,'г'],['Салат айсберг',30,'г'],['Хумус',40,'г']],
  'Golden Tuna Melt': [['Тостовый хлеб',2,'шт'],['Тунец',120,'г'],['Сыр чеддер',50,'г'],['Майонез',25,'г'],['Лук',20,'г'],['Помидоры',40,'г']],
  'Spicy Miso Ramen': [['Лапша рамэн',180,'г'],['Бульон',450,'мл'],['Мисо-паста',35,'г'],['Свинина',100,'г'],['Яйцо',1,'шт'],['Зеленый лук',15,'г']],
  'Teriyaki Bento': [['Рис',180,'г'],['Куриное филе',160,'г'],['Соус терияки',45,'мл'],['Брокколи',70,'г'],['Морковь',50,'г'],['Кунжут',5,'г']],
  'Salmon Sushi': [['Рис для суши',180,'г'],['Лосось',140,'г'],['Нори',2,'шт'],['Авокадо',60,'г'],['Соевый соус',30,'мл'],['Васаби',8,'г']],
  'Crispy Dumplings': [['Тесто для пельменей',180,'г'],['Свинина',120,'г'],['Капуста',70,'г'],['Зеленый лук',20,'г'],['Соевый соус',30,'мл'],['Растительное масло',20,'мл']],
  'Coconut Curry': [['Рис',180,'г'],['Куриное филе',140,'г'],['Кокосовое молоко',250,'мл'],['Карри-паста',30,'г'],['Перец болгарский',60,'г'],['Брокколи',60,'г']],
  'Family Feast': [['Куриное филе',500,'г'],['Картофель',600,'г'],['Рис',350,'г'],['Овощная смесь',400,'г'],['Соус BBQ',100,'г'],['Хлеб',4,'шт']],
  'Healthy Lunch Combo': [['Куриное филе',160,'г'],['Киноа',140,'г'],['Брокколи',100,'г'],['Авокадо',60,'г'],['Помидоры',70,'г'],['Оливковое масло',15,'мл']],
  'Protein Power Box': [['Куриное филе',180,'г'],['Яйцо',2,'шт'],['Киноа',150,'г'],['Нут',100,'г'],['Брокколи',100,'г'],['Соус йогуртовый',40,'г']],
  'Kids Favorite': [['Куриное филе',120,'г'],['Панировка',25,'г'],['Картофель',180,'г'],['Кетчуп',25,'г'],['Яблоко',1,'шт'],['Сок',200,'мл']],
  'Weekend Special': [['Говядина',220,'г'],['Картофель',250,'г'],['Шампиньоны',100,'г'],['Овощная смесь',180,'г'],['Сливочный соус',60,'г'],['Хлеб',2,'шт']]
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.secret !== WEBHOOK_SECRET) return response({ ok: false, error: 'Unauthorized' });
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    ensureRecipeSheet(spreadsheet);
    const result = payload.type === 'invoice' ? appendInvoice(spreadsheet, payload.invoice) : payload.type === 'dish' ? appendDish(spreadsheet, payload.dish) : appendOrder(spreadsheet, payload.order, payload.user);
    formatUsageSheet(spreadsheet);
    rebuildStock(spreadsheet);
    rebuildMovements(spreadsheet);
    formatWorkbook(spreadsheet);
    return response(result);
  } catch (error) { return response({ ok: false, error: error.message }); }
}

function appendOrder(spreadsheet, order, user) {
  const sheet = spreadsheet.getSheets().find(item => item.getSheetId() === ORDERS_SHEET_GID);
  if (!sheet) return { ok: false, error: 'Orders sheet not found' };
  const headers = ['Order number','Date','Customer','Email','Phone','Address','Items','Total','Status'];
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  const number = String(order && order.number || '');
  if (!number) return { ok: false, error: 'Order number is required' };
  if (columnContains(sheet, number)) return { ok: true, duplicate: true };
  const items = (order.items || []).map(item => `${item.name} x${item.qty} ($${Number(item.price).toFixed(2)})`).join('\n');
  sheet.appendRow([number,new Date(order.createdAt),order.recipient||user.name||'',user.email||'',order.phone||'',order.address||'',items,Number(order.total||0),order.status||'']);
  recordUsage(spreadsheet, order);
  return { ok: true };
}

function appendInvoice(spreadsheet, invoice) {
  let sheet = spreadsheet.getSheetByName(SHEETS.invoices);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEETS.invoices);
  const headers = ['Invoice number','Date','Product','Price','Packages','Weight','Line total','Stock amount','Unit'];
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  const number = String(invoice && invoice.number || '');
  if (!number) return { ok: false, error: 'Invoice number is required' };
  if (columnContains(sheet, number)) return { ok: true, duplicate: true };
  const rows = (invoice.items||[]).map(item => { const stock=parseStockAmount(item.weight,item.quantity); return [number,new Date(invoice.createdAt),item.name,Number(item.price),Number(item.quantity),item.weight,Number(item.total),stock.amount,stock.unit]; });
  if (!rows.length) return { ok: false, error: 'Invoice has no items' };
  sheet.getRange(sheet.getLastRow()+1,1,rows.length,headers.length).setValues(rows);
  return { ok: true, rows: rows.length };
}

function appendDish(spreadsheet,dish) {
  const sheet=spreadsheet.getSheetByName(SHEETS.recipes);if(!sheet)return{ok:false,error:'Recipes sheet not found'};
  const name=String(dish&&dish.name||'').trim();if(!name)return{ok:false,error:'Dish name is required'};
  const existing=sheet.getRange(2,1,Math.max(sheet.getLastRow()-1,1),1).getDisplayValues().flat().some(value=>String(value).toLowerCase()===name.toLowerCase());
  if(existing)return{ok:false,error:'Dish already exists'};
  const rows=(dish.recipe||[]).map(item=>[name,item.name,Number(item.amount),item.unit]);if(!rows.length)return{ok:false,error:'Dish recipe is empty'};
  sheet.getRange(sheet.getLastRow()+1,1,rows.length,4).setValues(rows);return{ok:true,rows:rows.length};
}

function ensureRecipeSheet(spreadsheet) {
  let sheet=spreadsheet.getSheetByName(SHEETS.recipes);
  if (!sheet) sheet=spreadsheet.insertSheet(SHEETS.recipes);
  if (sheet.getLastRow()>0) return;
  sheet.appendRow(['Dish','Ingredient','Amount per serving','Unit']);
  const rows=[]; Object.keys(DEFAULT_RECIPES).forEach(dish => DEFAULT_RECIPES[dish].forEach(item => rows.push([dish,item[0],item[1],item[2]])));
  sheet.getRange(2,1,rows.length,4).setValues(rows);
}

function recordUsage(spreadsheet, order) {
  let sheet=spreadsheet.getSheetByName(SHEETS.usage); if (!sheet) sheet=spreadsheet.insertSheet(SHEETS.usage);
  if (sheet.getLastRow()===0) sheet.appendRow(['Заказ','Дата','Блюдо','Ингредиент','Расход','Ед.']);
  const recipeSheet=spreadsheet.getSheetByName(SHEETS.recipes),data=recipeSheet.getDataRange().getValues().slice(1),recipes={};let currentDish='';
  data.forEach(row => { currentDish=row[0]||currentDish;if(!currentDish||!row[1])return;if(!recipes[currentDish])recipes[currentDish]=[];recipes[currentDish].push({ingredient:row[1],amount:Number(row[2]),unit:row[3]}); });
  const rows=[]; (order.items||[]).forEach(item => (recipes[item.name]||[]).forEach(part => rows.push([String(order.number),new Date(order.createdAt),item.name,part.ingredient,part.amount*Number(item.qty||1),part.unit])));
  if (rows.length) sheet.getRange(sheet.getLastRow()+1,1,rows.length,6).setValues(rows);
}

function formatUsageSheet(spreadsheet) {
  const sheet=spreadsheet.getSheetByName(SHEETS.usage);if(!sheet||sheet.getLastRow()<1)return;
  const lastRow=sheet.getLastRow(),lastColumn=6;
  sheet.getRange(1,1,1,lastColumn).setValues([['Заказ','Дата','Блюдо','Ингредиент','Расход','Ед.']]);
  sheet.getRange(1,1,lastRow,lastColumn).breakApart();
  if(lastRow>1){
    const range=sheet.getRange(2,1,lastRow-1,lastColumn),values=range.getValues();let previousOrder='',previousDate='',previousDish='';
    values.forEach(row=>{if(row[0]!==''&&row[0]!=null)previousOrder=row[0];else row[0]=previousOrder;if(row[1]!==''&&row[1]!=null)previousDate=row[1];else row[1]=previousDate;if(row[2]!==''&&row[2]!=null)previousDish=row[2];else row[2]=previousDish;});
    range.setValues(values).setFontSize(10).setVerticalAlignment('middle');
    let start=0,groupIndex=0;
    const formatGroup=(from,to)=>{const rowStart=from+2,count=to-from+1,color=groupIndex%2===0?'#FFF7F2':'#F3F7FF',groupRange=sheet.getRange(rowStart,1,count,lastColumn);groupRange.setBackground(color).setBorder(true,null,true,null,null,null,'#C8CDD5',SpreadsheetApp.BorderStyle.SOLID_MEDIUM);if(count>1){sheet.getRange(rowStart,1,count,1).merge();sheet.getRange(rowStart,2,count,1).merge();sheet.getRange(rowStart,3,count,1).merge();}sheet.getRange(rowStart,1,count,3).setVerticalAlignment('middle');sheet.getRange(rowStart,3,count,1).setFontWeight('bold').setFontSize(11).setFontColor('#C64B22').setWrap(true);groupIndex++;};
    for(let index=1;index<=values.length;index++){const changed=index===values.length||values[index][0]!==values[start][0]||values[index][2]!==values[start][2];if(changed){formatGroup(start,index-1);start=index;}}
  }
  sheet.setFrozenRows(1);sheet.setRowHeight(1,34);
  sheet.getRange(1,1,1,lastColumn).setBackground('#FE7143').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sheet.setColumnWidth(1,110);sheet.setColumnWidth(2,105);sheet.setColumnWidth(3,220);sheet.setColumnWidth(4,230);sheet.setColumnWidth(5,90);sheet.setColumnWidth(6,65);
  sheet.getRange(2,2,Math.max(lastRow-1,1),1).setNumberFormat('dd.MM.yyyy HH:mm');
  sheet.getRange(2,4,Math.max(lastRow-1,1),1).setWrap(true);
}

function rebuildStock(spreadsheet) {
  const balances={};
  const add=(name,unit,received,used)=>{const key=String(name).trim().toLowerCase()+'|'+unit;if(!balances[key])balances[key]={name:String(name).trim(),unit,received:0,used:0};balances[key].received+=received;balances[key].used+=used;};
  const invoices=spreadsheet.getSheetByName(SHEETS.invoices); if(invoices&&invoices.getLastRow()>1) invoices.getRange(2,1,invoices.getLastRow()-1,9).getValues().forEach(row=>add(row[2],row[8],Number(row[7])||0,0));
  const usage=spreadsheet.getSheetByName(SHEETS.usage); if(usage&&usage.getLastRow()>1) usage.getRange(2,1,usage.getLastRow()-1,6).getValues().forEach(row=>add(row[3],row[5],0,Number(row[4])||0));
  let sheet=spreadsheet.getSheetByName(SHEETS.stock); if(!sheet)sheet=spreadsheet.insertSheet(SHEETS.stock); sheet.clearContents(); sheet.appendRow(['Product','Unit','Received','Used','Balance']);
  const rows=Object.values(balances).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>[item.name,item.unit,item.received,item.used,item.received-item.used]); if(rows.length)sheet.getRange(2,1,rows.length,5).setValues(rows);
}

function rebuildMovements(spreadsheet) {
  const rows=[];
  const invoices=spreadsheet.getSheetByName(SHEETS.invoices);
  if(invoices&&invoices.getLastRow()>1)invoices.getRange(2,1,invoices.getLastRow()-1,9).getValues().forEach(row=>rows.push([row[1],'Приход',row[0],row[2],Number(row[7])||0,row[8],'']));
  const usage=spreadsheet.getSheetByName(SHEETS.usage);
  if(usage&&usage.getLastRow()>1){let order='',date='',dish='';usage.getRange(2,1,usage.getLastRow()-1,6).getValues().forEach(row=>{order=row[0]||order;date=row[1]||date;dish=row[2]||dish;rows.push([date,'Расход',order,row[3],-(Number(row[4])||0),row[5],dish]);});}
  rows.sort((a,b)=>new Date(a[0])-new Date(b[0]));
  let sheet=spreadsheet.getSheetByName(SHEETS.movements);if(!sheet)sheet=spreadsheet.insertSheet(SHEETS.movements);sheet.clearContents();sheet.appendRow(['Date','Type','Document','Product','Change','Unit','Dish']);
  if(rows.length)sheet.getRange(2,1,rows.length,7).setValues(rows);
}

function styleHeader(sheet,columns,color) {
  if(!sheet||sheet.getLastRow()<1)return;
  sheet.setFrozenRows(1);sheet.setRowHeight(1,36);sheet.setHiddenGridlines(true);
  sheet.getRange(1,1,1,columns).setBackground(color).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.getRange(1,1,Math.max(sheet.getLastRow(),1),columns).setFontFamily('Arial').setVerticalAlignment('middle');
}

function formatRecipeSheet(sheet) {
  if(!sheet||sheet.getLastRow()<1)return;const lastRow=sheet.getLastRow();
  sheet.getRange(1,1,lastRow,4).breakApart();
  if(lastRow>1){const range=sheet.getRange(2,1,lastRow-1,4),values=range.getValues();let dish='';values.forEach(row=>{dish=row[0]||dish;row[0]=dish;});range.setValues(values);let start=0,group=0;const finish=(from,to)=>{const row=from+2,count=to-from+1,color=group++%2===0?'#F5F1FC':'#FBF9FE';sheet.getRange(row,1,count,4).setBackground(color).setBorder(true,null,true,null,null,null,'#D6D0E5',SpreadsheetApp.BorderStyle.SOLID_MEDIUM);if(count>1)sheet.getRange(row,1,count,1).merge();sheet.getRange(row,1,count,1).setVerticalAlignment('middle').setFontWeight('bold').setFontSize(11).setFontColor('#4527A0').setWrap(true);};for(let index=1;index<=values.length;index++)if(index===values.length||values[index][0]!==values[start][0]){finish(start,index-1);start=index;}}
  styleHeader(sheet,4,'#5E35B1');sheet.getRange(1,1,1,4).setValues([['Блюдо','Ингредиент','Норма на 1 порцию','Ед.']]);sheet.setColumnWidth(1,240);sheet.setColumnWidth(2,235);sheet.setColumnWidth(3,175);sheet.setColumnWidth(4,70);sheet.setTabColor('#5E35B1');
}

function paintGroups(sheet,keyColumn,columns,colors) {
  if(!sheet||sheet.getLastRow()<2)return;
  const values=sheet.getRange(2,keyColumn,sheet.getLastRow()-1,1).getDisplayValues().flat();let start=0,group=0;
  const paint=(from,to)=>sheet.getRange(from+2,1,to-from+1,columns).setBackground(colors[group++%colors.length]).setBorder(true,null,true,null,null,null,'#D8DDE5',SpreadsheetApp.BorderStyle.SOLID);
  for(let index=1;index<=values.length;index++)if(index===values.length||values[index]!==values[start]){paint(start,index-1);start=index;}
}

function formatWorkbook(spreadsheet) {
  const orders=spreadsheet.getSheets().find(item=>item.getSheetId()===ORDERS_SHEET_GID);
  if(orders){orders.getRange(1,1,1,9).setValues([['№ заказа','Дата','Клиент','Email','Телефон','Адрес','Состав заказа','Сумма','Статус']]);styleHeader(orders,9,'#FE7143');paintGroups(orders,1,9,['#FFF8F4','#F7FAFF']);orders.setColumnWidth(1,105);orders.setColumnWidth(2,135);orders.setColumnWidth(3,170);orders.setColumnWidth(4,210);orders.setColumnWidth(5,135);orders.setColumnWidth(6,260);orders.setColumnWidth(7,330);orders.setColumnWidth(8,95);orders.setColumnWidth(9,105);if(orders.getLastRow()>1){orders.getRange(2,2,orders.getLastRow()-1,1).setNumberFormat('dd.MM.yyyy HH:mm');orders.getRange(2,7,orders.getLastRow()-1,1).setWrap(true);orders.getRange(2,8,orders.getLastRow()-1,1).setNumberFormat('$0.00');}orders.setTabColor('#FE7143');}

  const invoices=spreadsheet.getSheetByName(SHEETS.invoices);
  if(invoices){invoices.getRange(1,1,1,9).setValues([['№ фактуры','Дата','Продукт','Цена','Упаковок','Общий вес/объём','Сумма','На склад','Ед.']]);styleHeader(invoices,9,'#2E7D32');paintGroups(invoices,1,9,['#F1F8F2','#F8FBF8']);invoices.setColumnWidth(1,175);invoices.setColumnWidth(2,135);invoices.setColumnWidth(3,220);invoices.setColumnWidth(4,90);invoices.setColumnWidth(5,95);invoices.setColumnWidth(6,150);invoices.setColumnWidth(7,95);invoices.setColumnWidth(8,105);invoices.setColumnWidth(9,65);if(invoices.getLastRow()>1){invoices.getRange(2,2,invoices.getLastRow()-1,1).setNumberFormat('dd.MM.yyyy HH:mm');invoices.getRange(2,4,invoices.getLastRow()-1,1).setNumberFormat('$0.00');invoices.getRange(2,7,invoices.getLastRow()-1,1).setNumberFormat('$0.00');}invoices.setTabColor('#2E7D32');}

  const recipes=spreadsheet.getSheetByName(SHEETS.recipes);if(recipes)formatRecipeSheet(recipes);

  const stock=spreadsheet.getSheetByName(SHEETS.stock);
  if(stock){stock.getRange(1,1,1,5).setValues([['Продукт','Ед.','Поступило','Использовано','Остаток']]);styleHeader(stock,5,'#1565C0');stock.setColumnWidth(1,250);stock.setColumnWidth(2,70);stock.setColumnWidth(3,120);stock.setColumnWidth(4,135);stock.setColumnWidth(5,120);if(stock.getLastRow()>1){const range=stock.getRange(2,1,stock.getLastRow()-1,5),values=range.getValues();values.forEach((row,index)=>{const balance=Number(row[4])||0,color=balance<0?'#FFEBEE':balance===0?'#FFF8E1':'#E8F5E9';stock.getRange(index+2,1,1,5).setBackground(color);stock.getRange(index+2,5).setFontWeight('bold').setFontColor(balance<0?'#C62828':balance===0?'#EF6C00':'#2E7D32');});stock.getRange(2,3,stock.getLastRow()-1,3).setNumberFormat('0.###');}stock.setTabColor('#1565C0');}

  const movements=spreadsheet.getSheetByName(SHEETS.movements);
  if(movements){movements.getRange(1,1,1,7).setValues([['Дата','Операция','Документ','Продукт','Изменение','Ед.','Блюдо']]);styleHeader(movements,7,'#455A64');movements.setColumnWidth(1,135);movements.setColumnWidth(2,95);movements.setColumnWidth(3,175);movements.setColumnWidth(4,220);movements.setColumnWidth(5,115);movements.setColumnWidth(6,65);movements.setColumnWidth(7,220);if(movements.getLastRow()>1){const values=movements.getRange(2,1,movements.getLastRow()-1,7).getValues();values.forEach((row,index)=>{const incoming=row[1]==='Приход';movements.getRange(index+2,1,1,7).setBackground(incoming?'#E8F5E9':'#FFF3E0');movements.getRange(index+2,2).setFontWeight('bold').setFontColor(incoming?'#2E7D32':'#E65100');});movements.getRange(2,1,movements.getLastRow()-1,1).setNumberFormat('dd.MM.yyyy HH:mm');movements.getRange(2,5,movements.getLastRow()-1,1).setNumberFormat('+0.###;-0.###;0');}movements.setTabColor('#455A64');}

  const usage=spreadsheet.getSheetByName(SHEETS.usage);if(usage)usage.setTabColor('#E65100');
}

function parseStockAmount(weight,quantity) { const match=String(weight||'').trim().toLowerCase().match(/^([\d.,]+)\s*(кг|г|л|мл|шт)?$/); if(!match)return{amount:Number(quantity)||0,unit:'шт'};let amount=Number(match[1].replace(',','.')),unit=match[2]||'шт';if(unit==='кг'){amount*=1000;unit='г';}if(unit==='л'){amount*=1000;unit='мл';}return{amount,unit}; }
function columnContains(sheet,value){return sheet.getRange(1,1,Math.max(sheet.getLastRow(),1),1).getDisplayValues().flat().includes(value);}
function response(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
