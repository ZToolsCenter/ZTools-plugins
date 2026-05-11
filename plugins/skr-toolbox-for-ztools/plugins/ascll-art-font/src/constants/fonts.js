import figlet from "figlet";

import font0 from "figlet/importable-fonts/1Row";
import font1 from "figlet/importable-fonts/3-D";
import font2 from "figlet/importable-fonts/3D Diagonal";
import font3 from "figlet/importable-fonts/3D-ASCII";
import font4 from "figlet/importable-fonts/3x5";
import font5 from "figlet/importable-fonts/4Max";
import font6 from "figlet/importable-fonts/5 Line Oblique";
import font7 from "figlet/importable-fonts/AMC 3 Line";
import font8 from "figlet/importable-fonts/AMC 3 Liv1";
import font9 from "figlet/importable-fonts/AMC AAA01";
import font10 from "figlet/importable-fonts/AMC Neko";
import font11 from "figlet/importable-fonts/AMC Razor";
import font12 from "figlet/importable-fonts/AMC Razor2";
import font13 from "figlet/importable-fonts/AMC Slash";
import font14 from "figlet/importable-fonts/AMC Slider";
import font15 from "figlet/importable-fonts/AMC Thin";
import font16 from "figlet/importable-fonts/AMC Tubes";
import font17 from "figlet/importable-fonts/AMC Untitled";
import font18 from "figlet/importable-fonts/ANSI Compact";
import font19 from "figlet/importable-fonts/ANSI Regular";
import font20 from "figlet/importable-fonts/ANSI Shadow";
import font21 from "figlet/importable-fonts/ANSI-Compact";
import font22 from "figlet/importable-fonts/ASCII 12";
import font23 from "figlet/importable-fonts/ASCII 9";
import font24 from "figlet/importable-fonts/ASCII New Roman";
import font25 from "figlet/importable-fonts/Acrobatic";
import font26 from "figlet/importable-fonts/Alligator";
import font27 from "figlet/importable-fonts/Alligator2";
import font28 from "figlet/importable-fonts/Alpha";
import font29 from "figlet/importable-fonts/Alphabet";
import font30 from "figlet/importable-fonts/Arrows";
import font31 from "figlet/importable-fonts/Avatar";
import font32 from "figlet/importable-fonts/B1FF";
import font33 from "figlet/importable-fonts/Babyface Lame";
import font34 from "figlet/importable-fonts/Babyface Leet";
import font35 from "figlet/importable-fonts/Banner";
import font36 from "figlet/importable-fonts/Banner3";
import font37 from "figlet/importable-fonts/Banner3-D";
import font38 from "figlet/importable-fonts/Banner4";
import font39 from "figlet/importable-fonts/Barbwire";
import font40 from "figlet/importable-fonts/Basic";
import font41 from "figlet/importable-fonts/Bear";
import font42 from "figlet/importable-fonts/Bell";
import font43 from "figlet/importable-fonts/Benjamin";
import font44 from "figlet/importable-fonts/Big";
import font45 from "figlet/importable-fonts/Big ASCII 12";
import font46 from "figlet/importable-fonts/Big ASCII 9";
import font47 from "figlet/importable-fonts/Big Chief";
import font48 from "figlet/importable-fonts/Big Money-ne";
import font49 from "figlet/importable-fonts/Big Money-nw";
import font50 from "figlet/importable-fonts/Big Money-se";
import font51 from "figlet/importable-fonts/Big Money-sw";
import font52 from "figlet/importable-fonts/Big Mono 12";
import font53 from "figlet/importable-fonts/Big Mono 9";
import font54 from "figlet/importable-fonts/Bigfig";
import font55 from "figlet/importable-fonts/Binary";
import font56 from "figlet/importable-fonts/Block";
import font57 from "figlet/importable-fonts/Blocks";
import font58 from "figlet/importable-fonts/Bloody";
import font59 from "figlet/importable-fonts/BlurVision ASCII";
import font60 from "figlet/importable-fonts/Bolger";
import font61 from "figlet/importable-fonts/Braced";
import font62 from "figlet/importable-fonts/Bright";
import font63 from "figlet/importable-fonts/Broadway";
import font64 from "figlet/importable-fonts/Broadway KB";
import font65 from "figlet/importable-fonts/Bubble";
import font66 from "figlet/importable-fonts/Bulbhead";
import font67 from "figlet/importable-fonts/Caligraphy";
import font68 from "figlet/importable-fonts/Caligraphy2";
import font69 from "figlet/importable-fonts/Calvin S";
import font70 from "figlet/importable-fonts/Cards";
import font71 from "figlet/importable-fonts/Catwalk";
import font72 from "figlet/importable-fonts/Chiseled";
import font73 from "figlet/importable-fonts/Chunky";
import font74 from "figlet/importable-fonts/Circle";
import font75 from "figlet/importable-fonts/Classy";
import font76 from "figlet/importable-fonts/Coder Mini";
import font77 from "figlet/importable-fonts/Coinstak";
import font78 from "figlet/importable-fonts/Cola";
import font79 from "figlet/importable-fonts/Colossal";
import font80 from "figlet/importable-fonts/Computer";
import font81 from "figlet/importable-fonts/Contessa";
import font82 from "figlet/importable-fonts/Contrast";
import font83 from "figlet/importable-fonts/Cosmike";
import font84 from "figlet/importable-fonts/Cosmike2";
import font85 from "figlet/importable-fonts/Crawford";
import font86 from "figlet/importable-fonts/Crawford2";
import font87 from "figlet/importable-fonts/Crazy";
import font88 from "figlet/importable-fonts/Cricket";
import font89 from "figlet/importable-fonts/Cursive";
import font90 from "figlet/importable-fonts/Cyberlarge";
import font91 from "figlet/importable-fonts/Cybermedium";
import font92 from "figlet/importable-fonts/Cybersmall";
import font93 from "figlet/importable-fonts/Cygnet";
import font94 from "figlet/importable-fonts/DANC4";
import font95 from "figlet/importable-fonts/DOS Rebel";
import font96 from "figlet/importable-fonts/DWhistled";
import font97 from "figlet/importable-fonts/Dancing Font";
import font98 from "figlet/importable-fonts/Decimal";
import font99 from "figlet/importable-fonts/Def Leppard";
import font100 from "figlet/importable-fonts/Delta Corps Priest 1";
import font101 from "figlet/importable-fonts/DiamFont";
import font102 from "figlet/importable-fonts/Diamond";
import font103 from "figlet/importable-fonts/Diet Cola";
import font104 from "figlet/importable-fonts/Digital";
import font105 from "figlet/importable-fonts/Doh";
import font106 from "figlet/importable-fonts/Doom";
import font107 from "figlet/importable-fonts/Dot Matrix";
import font108 from "figlet/importable-fonts/Double";
import font109 from "figlet/importable-fonts/Double Shorts";
import font110 from "figlet/importable-fonts/Dr Pepper";
import font111 from "figlet/importable-fonts/Efti Chess";
import font112 from "figlet/importable-fonts/Efti Font";
import font113 from "figlet/importable-fonts/Efti Italic";
import font114 from "figlet/importable-fonts/Efti Piti";
import font115 from "figlet/importable-fonts/Efti Robot";
import font116 from "figlet/importable-fonts/Efti Wall";
import font117 from "figlet/importable-fonts/Efti Water";
import font118 from "figlet/importable-fonts/Electronic";
import font119 from "figlet/importable-fonts/Elite";
import font120 from "figlet/importable-fonts/Emboss";
import font121 from "figlet/importable-fonts/Emboss 2";
import font122 from "figlet/importable-fonts/Epic";
import font123 from "figlet/importable-fonts/Fender";
import font124 from "figlet/importable-fonts/Filter";
import font125 from "figlet/importable-fonts/Fire Font-k";
import font126 from "figlet/importable-fonts/Fire Font-s";
import font127 from "figlet/importable-fonts/Flipped";
import font128 from "figlet/importable-fonts/Flower Power";
import font129 from "figlet/importable-fonts/Font Font";
import font130 from "figlet/importable-fonts/Four Tops";
import font131 from "figlet/importable-fonts/Fraktur";
import font132 from "figlet/importable-fonts/Fun Face";
import font133 from "figlet/importable-fonts/Fun Faces";
import font134 from "figlet/importable-fonts/Future";
import font135 from "figlet/importable-fonts/Fuzzy";
import font136 from "figlet/importable-fonts/Georgi16";
import font137 from "figlet/importable-fonts/Georgia11";
import font138 from "figlet/importable-fonts/Ghost";
import font139 from "figlet/importable-fonts/Ghoulish";
import font140 from "figlet/importable-fonts/Glenyn";
import font141 from "figlet/importable-fonts/Goofy";
import font142 from "figlet/importable-fonts/Gothic";
import font143 from "figlet/importable-fonts/Graceful";
import font144 from "figlet/importable-fonts/Gradient";
import font145 from "figlet/importable-fonts/Graffiti";
import font146 from "figlet/importable-fonts/Greek";
import font147 from "figlet/importable-fonts/Heart Left";
import font148 from "figlet/importable-fonts/Heart Right";
import font149 from "figlet/importable-fonts/Henry 3D";
import font150 from "figlet/importable-fonts/Hex";
import font151 from "figlet/importable-fonts/Hieroglyphs";
import font152 from "figlet/importable-fonts/Hollywood";
import font153 from "figlet/importable-fonts/Horizontal Left";
import font154 from "figlet/importable-fonts/Horizontal Right";
import font155 from "figlet/importable-fonts/ICL-1900";
import font156 from "figlet/importable-fonts/Impossible";
import font157 from "figlet/importable-fonts/Invita";
import font158 from "figlet/importable-fonts/Isometric1";
import font159 from "figlet/importable-fonts/Isometric2";
import font160 from "figlet/importable-fonts/Isometric3";
import font161 from "figlet/importable-fonts/Isometric4";
import font162 from "figlet/importable-fonts/Italic";
import font163 from "figlet/importable-fonts/Ivrit";
import font164 from "figlet/importable-fonts/JS Block Letters";
import font165 from "figlet/importable-fonts/JS Bracket Letters";
import font166 from "figlet/importable-fonts/JS Capital Curves";
import font167 from "figlet/importable-fonts/JS Cursive";
import font168 from "figlet/importable-fonts/JS Stick Letters";
import font169 from "figlet/importable-fonts/Jacky";
import font170 from "figlet/importable-fonts/Jazmine";
import font171 from "figlet/importable-fonts/Jerusalem";
import font172 from "figlet/importable-fonts/Katakana";
import font173 from "figlet/importable-fonts/Kban";
import font174 from "figlet/importable-fonts/Keyboard";
import font175 from "figlet/importable-fonts/Knob";
import font176 from "figlet/importable-fonts/Konto";
import font177 from "figlet/importable-fonts/Konto Slant";
import font178 from "figlet/importable-fonts/LCD";
import font179 from "figlet/importable-fonts/Larry 3D";
import font180 from "figlet/importable-fonts/Larry 3D 2";
import font181 from "figlet/importable-fonts/Lean";
import font182 from "figlet/importable-fonts/Letter";
import font183 from "figlet/importable-fonts/Letters";
import font184 from "figlet/importable-fonts/Lil Devil";
import font185 from "figlet/importable-fonts/Line Blocks";
import font186 from "figlet/importable-fonts/Linux";
import font187 from "figlet/importable-fonts/Lockergnome";
import font188 from "figlet/importable-fonts/Madrid";
import font189 from "figlet/importable-fonts/Marquee";
import font190 from "figlet/importable-fonts/Maxfour";
import font191 from "figlet/importable-fonts/Merlin1";
import font192 from "figlet/importable-fonts/Merlin2";
import font193 from "figlet/importable-fonts/Mike";
import font194 from "figlet/importable-fonts/Mini";
import font195 from "figlet/importable-fonts/Mirror";
import font196 from "figlet/importable-fonts/Mnemonic";
import font197 from "figlet/importable-fonts/Modular";
import font198 from "figlet/importable-fonts/Mono 12";
import font199 from "figlet/importable-fonts/Mono 9";
import font200 from "figlet/importable-fonts/Morse";
import font201 from "figlet/importable-fonts/Morse2";
import font202 from "figlet/importable-fonts/Moscow";
import font203 from "figlet/importable-fonts/Mshebrew210";
import font204 from "figlet/importable-fonts/Muzzle";
import font205 from "figlet/importable-fonts/NScript";
import font206 from "figlet/importable-fonts/NT Greek";
import font207 from "figlet/importable-fonts/NV Script";
import font208 from "figlet/importable-fonts/Nancyj";
import font209 from "figlet/importable-fonts/Nancyj-Fancy";
import font210 from "figlet/importable-fonts/Nancyj-Improved";
import font211 from "figlet/importable-fonts/Nancyj-Underlined";
import font212 from "figlet/importable-fonts/Nipples";
import font213 from "figlet/importable-fonts/O8";
import font214 from "figlet/importable-fonts/OS2";
import font215 from "figlet/importable-fonts/Octal";
import font216 from "figlet/importable-fonts/Ogre";
import font217 from "figlet/importable-fonts/Old Banner";
import font218 from "figlet/importable-fonts/Pagga";
import font219 from "figlet/importable-fonts/Patorjk's Cheese";
import font220 from "figlet/importable-fonts/Patorjk-HeX";
import font221 from "figlet/importable-fonts/Pawp";
import font222 from "figlet/importable-fonts/Peaks";
import font223 from "figlet/importable-fonts/Peaks Slant";
import font224 from "figlet/importable-fonts/Pebbles";
import font225 from "figlet/importable-fonts/Pepper";
import font226 from "figlet/importable-fonts/Poison";
import font227 from "figlet/importable-fonts/Puffy";
import font228 from "figlet/importable-fonts/Puzzle";
import font229 from "figlet/importable-fonts/Pyramid";
import font230 from "figlet/importable-fonts/Rammstein";
import font231 from "figlet/importable-fonts/Rebel";
import font232 from "figlet/importable-fonts/Rectangles";
import font233 from "figlet/importable-fonts/Red Phoenix";
import font234 from "figlet/importable-fonts/Relief";
import font235 from "figlet/importable-fonts/Relief2";
import font236 from "figlet/importable-fonts/Reverse";
import font237 from "figlet/importable-fonts/Roman";
import font238 from "figlet/importable-fonts/Rot13";
import font239 from "figlet/importable-fonts/Rotated";
import font240 from "figlet/importable-fonts/Rounded";
import font241 from "figlet/importable-fonts/Rowan Cap";
import font242 from "figlet/importable-fonts/Rozzo";
import font243 from "figlet/importable-fonts/RubiFont";
import font244 from "figlet/importable-fonts/Runic";
import font245 from "figlet/importable-fonts/Runyc";
import font246 from "figlet/importable-fonts/S Blood";
import font247 from "figlet/importable-fonts/SL Script";
import font248 from "figlet/importable-fonts/Santa Clara";
import font249 from "figlet/importable-fonts/Script";
import font250 from "figlet/importable-fonts/Serifcap";
import font251 from "figlet/importable-fonts/Shaded Blocky";
import font252 from "figlet/importable-fonts/Shadow";
import font253 from "figlet/importable-fonts/Shimrod";
import font254 from "figlet/importable-fonts/Short";
import font255 from "figlet/importable-fonts/Slant";
import font256 from "figlet/importable-fonts/Slant Relief";
import font257 from "figlet/importable-fonts/Slide";
import font258 from "figlet/importable-fonts/Small";
import font259 from "figlet/importable-fonts/Small ASCII 12";
import font260 from "figlet/importable-fonts/Small ASCII 9";
import font261 from "figlet/importable-fonts/Small Block";
import font262 from "figlet/importable-fonts/Small Braille";
import font263 from "figlet/importable-fonts/Small Caps";
import font264 from "figlet/importable-fonts/Small Isometric1";
import font265 from "figlet/importable-fonts/Small Keyboard";
import font266 from "figlet/importable-fonts/Small Mono 12";
import font267 from "figlet/importable-fonts/Small Mono 9";
import font268 from "figlet/importable-fonts/Small Poison";
import font269 from "figlet/importable-fonts/Small Script";
import font270 from "figlet/importable-fonts/Small Shadow";
import font271 from "figlet/importable-fonts/Small Slant";
import font272 from "figlet/importable-fonts/Small Tengwar";
import font273 from "figlet/importable-fonts/Soft";
import font274 from "figlet/importable-fonts/Speed";
import font275 from "figlet/importable-fonts/Spliff";
import font276 from "figlet/importable-fonts/Stacey";
import font277 from "figlet/importable-fonts/Stampate";
import font278 from "figlet/importable-fonts/Stampatello";
import font279 from "figlet/importable-fonts/Standard";
import font280 from "figlet/importable-fonts/Star Strips";
import font281 from "figlet/importable-fonts/Star Wars";
import font282 from "figlet/importable-fonts/Stellar";
import font283 from "figlet/importable-fonts/Stforek";
import font284 from "figlet/importable-fonts/Stick Letters";
import font285 from "figlet/importable-fonts/Stop";
import font286 from "figlet/importable-fonts/Straight";
import font287 from "figlet/importable-fonts/Stronger Than All";
import font288 from "figlet/importable-fonts/Sub-Zero";
import font289 from "figlet/importable-fonts/Swamp Land";
import font290 from "figlet/importable-fonts/Swan";
import font291 from "figlet/importable-fonts/Sweet";
import font292 from "figlet/importable-fonts/THIS";
import font293 from "figlet/importable-fonts/Tanja";
import font294 from "figlet/importable-fonts/Tengwar";
import font295 from "figlet/importable-fonts/Term";
import font296 from "figlet/importable-fonts/Terrace";
import font297 from "figlet/importable-fonts/Test1";
import font298 from "figlet/importable-fonts/The Edge";
import font299 from "figlet/importable-fonts/Thick";
import font300 from "figlet/importable-fonts/Thin";
import font301 from "figlet/importable-fonts/Thorned";
import font302 from "figlet/importable-fonts/Three Point";
import font303 from "figlet/importable-fonts/Ticks";
import font304 from "figlet/importable-fonts/Ticks Slant";
import font305 from "figlet/importable-fonts/Tiles";
import font306 from "figlet/importable-fonts/Tinker-Toy";
import font307 from "figlet/importable-fonts/Tombstone";
import font308 from "figlet/importable-fonts/Train";
import font309 from "figlet/importable-fonts/Trek";
import font310 from "figlet/importable-fonts/Tsalagi";
import font311 from "figlet/importable-fonts/Tubular";
import font312 from "figlet/importable-fonts/Twisted";
import font313 from "figlet/importable-fonts/Two Point";
import font314 from "figlet/importable-fonts/USA Flag";
import font315 from "figlet/importable-fonts/Univers";
import font316 from "figlet/importable-fonts/Upside Down Text";
import font317 from "figlet/importable-fonts/Varsity";
import font318 from "figlet/importable-fonts/Wavescape";
import font319 from "figlet/importable-fonts/Wavy";
import font320 from "figlet/importable-fonts/Weird";
import font321 from "figlet/importable-fonts/Wet Letter";
import font322 from "figlet/importable-fonts/Whimsy";
import font323 from "figlet/importable-fonts/WideTerm";
import font324 from "figlet/importable-fonts/Wow";
import font325 from "figlet/importable-fonts/babyface-lame";
import font326 from "figlet/importable-fonts/babyface-leet";
import font327 from "figlet/importable-fonts/miniwi";
import font328 from "figlet/importable-fonts/tmplr";

// Register all fonts
export function registerAllFonts() {
  figlet.parseFont("1Row", font0);
  figlet.parseFont("3-D", font1);
  figlet.parseFont("3D Diagonal", font2);
  figlet.parseFont("3D-ASCII", font3);
  figlet.parseFont("3x5", font4);
  figlet.parseFont("4Max", font5);
  figlet.parseFont("5 Line Oblique", font6);
  figlet.parseFont("AMC 3 Line", font7);
  figlet.parseFont("AMC 3 Liv1", font8);
  figlet.parseFont("AMC AAA01", font9);
  figlet.parseFont("AMC Neko", font10);
  figlet.parseFont("AMC Razor", font11);
  figlet.parseFont("AMC Razor2", font12);
  figlet.parseFont("AMC Slash", font13);
  figlet.parseFont("AMC Slider", font14);
  figlet.parseFont("AMC Thin", font15);
  figlet.parseFont("AMC Tubes", font16);
  figlet.parseFont("AMC Untitled", font17);
  figlet.parseFont("ANSI Compact", font18);
  figlet.parseFont("ANSI Regular", font19);
  figlet.parseFont("ANSI Shadow", font20);
  figlet.parseFont("ANSI-Compact", font21);
  figlet.parseFont("ASCII 12", font22);
  figlet.parseFont("ASCII 9", font23);
  figlet.parseFont("ASCII New Roman", font24);
  figlet.parseFont("Acrobatic", font25);
  figlet.parseFont("Alligator", font26);
  figlet.parseFont("Alligator2", font27);
  figlet.parseFont("Alpha", font28);
  figlet.parseFont("Alphabet", font29);
  figlet.parseFont("Arrows", font30);
  figlet.parseFont("Avatar", font31);
  figlet.parseFont("B1FF", font32);
  figlet.parseFont("Babyface Lame", font33);
  figlet.parseFont("Babyface Leet", font34);
  figlet.parseFont("Banner", font35);
  figlet.parseFont("Banner3", font36);
  figlet.parseFont("Banner3-D", font37);
  figlet.parseFont("Banner4", font38);
  figlet.parseFont("Barbwire", font39);
  figlet.parseFont("Basic", font40);
  figlet.parseFont("Bear", font41);
  figlet.parseFont("Bell", font42);
  figlet.parseFont("Benjamin", font43);
  figlet.parseFont("Big", font44);
  figlet.parseFont("Big ASCII 12", font45);
  figlet.parseFont("Big ASCII 9", font46);
  figlet.parseFont("Big Chief", font47);
  figlet.parseFont("Big Money-ne", font48);
  figlet.parseFont("Big Money-nw", font49);
  figlet.parseFont("Big Money-se", font50);
  figlet.parseFont("Big Money-sw", font51);
  figlet.parseFont("Big Mono 12", font52);
  figlet.parseFont("Big Mono 9", font53);
  figlet.parseFont("Bigfig", font54);
  figlet.parseFont("Binary", font55);
  figlet.parseFont("Block", font56);
  figlet.parseFont("Blocks", font57);
  figlet.parseFont("Bloody", font58);
  figlet.parseFont("BlurVision ASCII", font59);
  figlet.parseFont("Bolger", font60);
  figlet.parseFont("Braced", font61);
  figlet.parseFont("Bright", font62);
  figlet.parseFont("Broadway", font63);
  figlet.parseFont("Broadway KB", font64);
  figlet.parseFont("Bubble", font65);
  figlet.parseFont("Bulbhead", font66);
  figlet.parseFont("Caligraphy", font67);
  figlet.parseFont("Caligraphy2", font68);
  figlet.parseFont("Calvin S", font69);
  figlet.parseFont("Cards", font70);
  figlet.parseFont("Catwalk", font71);
  figlet.parseFont("Chiseled", font72);
  figlet.parseFont("Chunky", font73);
  figlet.parseFont("Circle", font74);
  figlet.parseFont("Classy", font75);
  figlet.parseFont("Coder Mini", font76);
  figlet.parseFont("Coinstak", font77);
  figlet.parseFont("Cola", font78);
  figlet.parseFont("Colossal", font79);
  figlet.parseFont("Computer", font80);
  figlet.parseFont("Contessa", font81);
  figlet.parseFont("Contrast", font82);
  figlet.parseFont("Cosmike", font83);
  figlet.parseFont("Cosmike2", font84);
  figlet.parseFont("Crawford", font85);
  figlet.parseFont("Crawford2", font86);
  figlet.parseFont("Crazy", font87);
  figlet.parseFont("Cricket", font88);
  figlet.parseFont("Cursive", font89);
  figlet.parseFont("Cyberlarge", font90);
  figlet.parseFont("Cybermedium", font91);
  figlet.parseFont("Cybersmall", font92);
  figlet.parseFont("Cygnet", font93);
  figlet.parseFont("DANC4", font94);
  figlet.parseFont("DOS Rebel", font95);
  figlet.parseFont("DWhistled", font96);
  figlet.parseFont("Dancing Font", font97);
  figlet.parseFont("Decimal", font98);
  figlet.parseFont("Def Leppard", font99);
  figlet.parseFont("Delta Corps Priest 1", font100);
  figlet.parseFont("DiamFont", font101);
  figlet.parseFont("Diamond", font102);
  figlet.parseFont("Diet Cola", font103);
  figlet.parseFont("Digital", font104);
  figlet.parseFont("Doh", font105);
  figlet.parseFont("Doom", font106);
  figlet.parseFont("Dot Matrix", font107);
  figlet.parseFont("Double", font108);
  figlet.parseFont("Double Shorts", font109);
  figlet.parseFont("Dr Pepper", font110);
  figlet.parseFont("Efti Chess", font111);
  figlet.parseFont("Efti Font", font112);
  figlet.parseFont("Efti Italic", font113);
  figlet.parseFont("Efti Piti", font114);
  figlet.parseFont("Efti Robot", font115);
  figlet.parseFont("Efti Wall", font116);
  figlet.parseFont("Efti Water", font117);
  figlet.parseFont("Electronic", font118);
  figlet.parseFont("Elite", font119);
  figlet.parseFont("Emboss", font120);
  figlet.parseFont("Emboss 2", font121);
  figlet.parseFont("Epic", font122);
  figlet.parseFont("Fender", font123);
  figlet.parseFont("Filter", font124);
  figlet.parseFont("Fire Font-k", font125);
  figlet.parseFont("Fire Font-s", font126);
  figlet.parseFont("Flipped", font127);
  figlet.parseFont("Flower Power", font128);
  figlet.parseFont("Font Font", font129);
  figlet.parseFont("Four Tops", font130);
  figlet.parseFont("Fraktur", font131);
  figlet.parseFont("Fun Face", font132);
  figlet.parseFont("Fun Faces", font133);
  figlet.parseFont("Future", font134);
  figlet.parseFont("Fuzzy", font135);
  figlet.parseFont("Georgi16", font136);
  figlet.parseFont("Georgia11", font137);
  figlet.parseFont("Ghost", font138);
  figlet.parseFont("Ghoulish", font139);
  figlet.parseFont("Glenyn", font140);
  figlet.parseFont("Goofy", font141);
  figlet.parseFont("Gothic", font142);
  figlet.parseFont("Graceful", font143);
  figlet.parseFont("Gradient", font144);
  figlet.parseFont("Graffiti", font145);
  figlet.parseFont("Greek", font146);
  figlet.parseFont("Heart Left", font147);
  figlet.parseFont("Heart Right", font148);
  figlet.parseFont("Henry 3D", font149);
  figlet.parseFont("Hex", font150);
  figlet.parseFont("Hieroglyphs", font151);
  figlet.parseFont("Hollywood", font152);
  figlet.parseFont("Horizontal Left", font153);
  figlet.parseFont("Horizontal Right", font154);
  figlet.parseFont("ICL-1900", font155);
  figlet.parseFont("Impossible", font156);
  figlet.parseFont("Invita", font157);
  figlet.parseFont("Isometric1", font158);
  figlet.parseFont("Isometric2", font159);
  figlet.parseFont("Isometric3", font160);
  figlet.parseFont("Isometric4", font161);
  figlet.parseFont("Italic", font162);
  figlet.parseFont("Ivrit", font163);
  figlet.parseFont("JS Block Letters", font164);
  figlet.parseFont("JS Bracket Letters", font165);
  figlet.parseFont("JS Capital Curves", font166);
  figlet.parseFont("JS Cursive", font167);
  figlet.parseFont("JS Stick Letters", font168);
  figlet.parseFont("Jacky", font169);
  figlet.parseFont("Jazmine", font170);
  figlet.parseFont("Jerusalem", font171);
  figlet.parseFont("Katakana", font172);
  figlet.parseFont("Kban", font173);
  figlet.parseFont("Keyboard", font174);
  figlet.parseFont("Knob", font175);
  figlet.parseFont("Konto", font176);
  figlet.parseFont("Konto Slant", font177);
  figlet.parseFont("LCD", font178);
  figlet.parseFont("Larry 3D", font179);
  figlet.parseFont("Larry 3D 2", font180);
  figlet.parseFont("Lean", font181);
  figlet.parseFont("Letter", font182);
  figlet.parseFont("Letters", font183);
  figlet.parseFont("Lil Devil", font184);
  figlet.parseFont("Line Blocks", font185);
  figlet.parseFont("Linux", font186);
  figlet.parseFont("Lockergnome", font187);
  figlet.parseFont("Madrid", font188);
  figlet.parseFont("Marquee", font189);
  figlet.parseFont("Maxfour", font190);
  figlet.parseFont("Merlin1", font191);
  figlet.parseFont("Merlin2", font192);
  figlet.parseFont("Mike", font193);
  figlet.parseFont("Mini", font194);
  figlet.parseFont("Mirror", font195);
  figlet.parseFont("Mnemonic", font196);
  figlet.parseFont("Modular", font197);
  figlet.parseFont("Mono 12", font198);
  figlet.parseFont("Mono 9", font199);
  figlet.parseFont("Morse", font200);
  figlet.parseFont("Morse2", font201);
  figlet.parseFont("Moscow", font202);
  figlet.parseFont("Mshebrew210", font203);
  figlet.parseFont("Muzzle", font204);
  figlet.parseFont("NScript", font205);
  figlet.parseFont("NT Greek", font206);
  figlet.parseFont("NV Script", font207);
  figlet.parseFont("Nancyj", font208);
  figlet.parseFont("Nancyj-Fancy", font209);
  figlet.parseFont("Nancyj-Improved", font210);
  figlet.parseFont("Nancyj-Underlined", font211);
  figlet.parseFont("Nipples", font212);
  figlet.parseFont("O8", font213);
  figlet.parseFont("OS2", font214);
  figlet.parseFont("Octal", font215);
  figlet.parseFont("Ogre", font216);
  figlet.parseFont("Old Banner", font217);
  figlet.parseFont("Pagga", font218);
  figlet.parseFont("Patorjk's Cheese", font219);
  figlet.parseFont("Patorjk-HeX", font220);
  figlet.parseFont("Pawp", font221);
  figlet.parseFont("Peaks", font222);
  figlet.parseFont("Peaks Slant", font223);
  figlet.parseFont("Pebbles", font224);
  figlet.parseFont("Pepper", font225);
  figlet.parseFont("Poison", font226);
  figlet.parseFont("Puffy", font227);
  figlet.parseFont("Puzzle", font228);
  figlet.parseFont("Pyramid", font229);
  figlet.parseFont("Rammstein", font230);
  figlet.parseFont("Rebel", font231);
  figlet.parseFont("Rectangles", font232);
  figlet.parseFont("Red Phoenix", font233);
  figlet.parseFont("Relief", font234);
  figlet.parseFont("Relief2", font235);
  figlet.parseFont("Reverse", font236);
  figlet.parseFont("Roman", font237);
  figlet.parseFont("Rot13", font238);
  figlet.parseFont("Rotated", font239);
  figlet.parseFont("Rounded", font240);
  figlet.parseFont("Rowan Cap", font241);
  figlet.parseFont("Rozzo", font242);
  figlet.parseFont("RubiFont", font243);
  figlet.parseFont("Runic", font244);
  figlet.parseFont("Runyc", font245);
  figlet.parseFont("S Blood", font246);
  figlet.parseFont("SL Script", font247);
  figlet.parseFont("Santa Clara", font248);
  figlet.parseFont("Script", font249);
  figlet.parseFont("Serifcap", font250);
  figlet.parseFont("Shaded Blocky", font251);
  figlet.parseFont("Shadow", font252);
  figlet.parseFont("Shimrod", font253);
  figlet.parseFont("Short", font254);
  figlet.parseFont("Slant", font255);
  figlet.parseFont("Slant Relief", font256);
  figlet.parseFont("Slide", font257);
  figlet.parseFont("Small", font258);
  figlet.parseFont("Small ASCII 12", font259);
  figlet.parseFont("Small ASCII 9", font260);
  figlet.parseFont("Small Block", font261);
  figlet.parseFont("Small Braille", font262);
  figlet.parseFont("Small Caps", font263);
  figlet.parseFont("Small Isometric1", font264);
  figlet.parseFont("Small Keyboard", font265);
  figlet.parseFont("Small Mono 12", font266);
  figlet.parseFont("Small Mono 9", font267);
  figlet.parseFont("Small Poison", font268);
  figlet.parseFont("Small Script", font269);
  figlet.parseFont("Small Shadow", font270);
  figlet.parseFont("Small Slant", font271);
  figlet.parseFont("Small Tengwar", font272);
  figlet.parseFont("Soft", font273);
  figlet.parseFont("Speed", font274);
  figlet.parseFont("Spliff", font275);
  figlet.parseFont("Stacey", font276);
  figlet.parseFont("Stampate", font277);
  figlet.parseFont("Stampatello", font278);
  figlet.parseFont("Standard", font279);
  figlet.parseFont("Star Strips", font280);
  figlet.parseFont("Star Wars", font281);
  figlet.parseFont("Stellar", font282);
  figlet.parseFont("Stforek", font283);
  figlet.parseFont("Stick Letters", font284);
  figlet.parseFont("Stop", font285);
  figlet.parseFont("Straight", font286);
  figlet.parseFont("Stronger Than All", font287);
  figlet.parseFont("Sub-Zero", font288);
  figlet.parseFont("Swamp Land", font289);
  figlet.parseFont("Swan", font290);
  figlet.parseFont("Sweet", font291);
  figlet.parseFont("THIS", font292);
  figlet.parseFont("Tanja", font293);
  figlet.parseFont("Tengwar", font294);
  figlet.parseFont("Term", font295);
  figlet.parseFont("Terrace", font296);
  figlet.parseFont("Test1", font297);
  figlet.parseFont("The Edge", font298);
  figlet.parseFont("Thick", font299);
  figlet.parseFont("Thin", font300);
  figlet.parseFont("Thorned", font301);
  figlet.parseFont("Three Point", font302);
  figlet.parseFont("Ticks", font303);
  figlet.parseFont("Ticks Slant", font304);
  figlet.parseFont("Tiles", font305);
  figlet.parseFont("Tinker-Toy", font306);
  figlet.parseFont("Tombstone", font307);
  figlet.parseFont("Train", font308);
  figlet.parseFont("Trek", font309);
  figlet.parseFont("Tsalagi", font310);
  figlet.parseFont("Tubular", font311);
  figlet.parseFont("Twisted", font312);
  figlet.parseFont("Two Point", font313);
  figlet.parseFont("USA Flag", font314);
  figlet.parseFont("Univers", font315);
  figlet.parseFont("Upside Down Text", font316);
  figlet.parseFont("Varsity", font317);
  figlet.parseFont("Wavescape", font318);
  figlet.parseFont("Wavy", font319);
  figlet.parseFont("Weird", font320);
  figlet.parseFont("Wet Letter", font321);
  figlet.parseFont("Whimsy", font322);
  figlet.parseFont("WideTerm", font323);
  figlet.parseFont("Wow", font324);
  figlet.parseFont("babyface-lame", font325);
  figlet.parseFont("babyface-leet", font326);
  figlet.parseFont("miniwi", font327);
  figlet.parseFont("tmplr", font328);
}

export const ALL_FONT_NAMES = [
  "1Row",
  "3-D",
  "3D Diagonal",
  "3D-ASCII",
  "3x5",
  "4Max",
  "5 Line Oblique",
  "AMC 3 Line",
  "AMC 3 Liv1",
  "AMC AAA01",
  "AMC Neko",
  "AMC Razor",
  "AMC Razor2",
  "AMC Slash",
  "AMC Slider",
  "AMC Thin",
  "AMC Tubes",
  "AMC Untitled",
  "ANSI Compact",
  "ANSI Regular",
  "ANSI Shadow",
  "ANSI-Compact",
  "ASCII 12",
  "ASCII 9",
  "ASCII New Roman",
  "Acrobatic",
  "Alligator",
  "Alligator2",
  "Alpha",
  "Alphabet",
  "Arrows",
  "Avatar",
  "B1FF",
  "Babyface Lame",
  "Babyface Leet",
  "Banner",
  "Banner3",
  "Banner3-D",
  "Banner4",
  "Barbwire",
  "Basic",
  "Bear",
  "Bell",
  "Benjamin",
  "Big",
  "Big ASCII 12",
  "Big ASCII 9",
  "Big Chief",
  "Big Money-ne",
  "Big Money-nw",
  "Big Money-se",
  "Big Money-sw",
  "Big Mono 12",
  "Big Mono 9",
  "Bigfig",
  "Binary",
  "Block",
  "Blocks",
  "Bloody",
  "BlurVision ASCII",
  "Bolger",
  "Braced",
  "Bright",
  "Broadway",
  "Broadway KB",
  "Bubble",
  "Bulbhead",
  "Caligraphy",
  "Caligraphy2",
  "Calvin S",
  "Cards",
  "Catwalk",
  "Chiseled",
  "Chunky",
  "Circle",
  "Classy",
  "Coder Mini",
  "Coinstak",
  "Cola",
  "Colossal",
  "Computer",
  "Contessa",
  "Contrast",
  "Cosmike",
  "Cosmike2",
  "Crawford",
  "Crawford2",
  "Crazy",
  "Cricket",
  "Cursive",
  "Cyberlarge",
  "Cybermedium",
  "Cybersmall",
  "Cygnet",
  "DANC4",
  "DOS Rebel",
  "DWhistled",
  "Dancing Font",
  "Decimal",
  "Def Leppard",
  "Delta Corps Priest 1",
  "DiamFont",
  "Diamond",
  "Diet Cola",
  "Digital",
  "Doh",
  "Doom",
  "Dot Matrix",
  "Double",
  "Double Shorts",
  "Dr Pepper",
  "Efti Chess",
  "Efti Font",
  "Efti Italic",
  "Efti Piti",
  "Efti Robot",
  "Efti Wall",
  "Efti Water",
  "Electronic",
  "Elite",
  "Emboss",
  "Emboss 2",
  "Epic",
  "Fender",
  "Filter",
  "Fire Font-k",
  "Fire Font-s",
  "Flipped",
  "Flower Power",
  "Font Font",
  "Four Tops",
  "Fraktur",
  "Fun Face",
  "Fun Faces",
  "Future",
  "Fuzzy",
  "Georgi16",
  "Georgia11",
  "Ghost",
  "Ghoulish",
  "Glenyn",
  "Goofy",
  "Gothic",
  "Graceful",
  "Gradient",
  "Graffiti",
  "Greek",
  "Heart Left",
  "Heart Right",
  "Henry 3D",
  "Hex",
  "Hieroglyphs",
  "Hollywood",
  "Horizontal Left",
  "Horizontal Right",
  "ICL-1900",
  "Impossible",
  "Invita",
  "Isometric1",
  "Isometric2",
  "Isometric3",
  "Isometric4",
  "Italic",
  "Ivrit",
  "JS Block Letters",
  "JS Bracket Letters",
  "JS Capital Curves",
  "JS Cursive",
  "JS Stick Letters",
  "Jacky",
  "Jazmine",
  "Jerusalem",
  "Katakana",
  "Kban",
  "Keyboard",
  "Knob",
  "Konto",
  "Konto Slant",
  "LCD",
  "Larry 3D",
  "Larry 3D 2",
  "Lean",
  "Letter",
  "Letters",
  "Lil Devil",
  "Line Blocks",
  "Linux",
  "Lockergnome",
  "Madrid",
  "Marquee",
  "Maxfour",
  "Merlin1",
  "Merlin2",
  "Mike",
  "Mini",
  "Mirror",
  "Mnemonic",
  "Modular",
  "Mono 12",
  "Mono 9",
  "Morse",
  "Morse2",
  "Moscow",
  "Mshebrew210",
  "Muzzle",
  "NScript",
  "NT Greek",
  "NV Script",
  "Nancyj",
  "Nancyj-Fancy",
  "Nancyj-Improved",
  "Nancyj-Underlined",
  "Nipples",
  "O8",
  "OS2",
  "Octal",
  "Ogre",
  "Old Banner",
  "Pagga",
  "Patorjk's Cheese",
  "Patorjk-HeX",
  "Pawp",
  "Peaks",
  "Peaks Slant",
  "Pebbles",
  "Pepper",
  "Poison",
  "Puffy",
  "Puzzle",
  "Pyramid",
  "Rammstein",
  "Rebel",
  "Rectangles",
  "Red Phoenix",
  "Relief",
  "Relief2",
  "Reverse",
  "Roman",
  "Rot13",
  "Rotated",
  "Rounded",
  "Rowan Cap",
  "Rozzo",
  "RubiFont",
  "Runic",
  "Runyc",
  "S Blood",
  "SL Script",
  "Santa Clara",
  "Script",
  "Serifcap",
  "Shaded Blocky",
  "Shadow",
  "Shimrod",
  "Short",
  "Slant",
  "Slant Relief",
  "Slide",
  "Small",
  "Small ASCII 12",
  "Small ASCII 9",
  "Small Block",
  "Small Braille",
  "Small Caps",
  "Small Isometric1",
  "Small Keyboard",
  "Small Mono 12",
  "Small Mono 9",
  "Small Poison",
  "Small Script",
  "Small Shadow",
  "Small Slant",
  "Small Tengwar",
  "Soft",
  "Speed",
  "Spliff",
  "Stacey",
  "Stampate",
  "Stampatello",
  "Standard",
  "Star Strips",
  "Star Wars",
  "Stellar",
  "Stforek",
  "Stick Letters",
  "Stop",
  "Straight",
  "Stronger Than All",
  "Sub-Zero",
  "Swamp Land",
  "Swan",
  "Sweet",
  "THIS",
  "Tanja",
  "Tengwar",
  "Term",
  "Terrace",
  "Test1",
  "The Edge",
  "Thick",
  "Thin",
  "Thorned",
  "Three Point",
  "Ticks",
  "Ticks Slant",
  "Tiles",
  "Tinker-Toy",
  "Tombstone",
  "Train",
  "Trek",
  "Tsalagi",
  "Tubular",
  "Twisted",
  "Two Point",
  "USA Flag",
  "Univers",
  "Upside Down Text",
  "Varsity",
  "Wavescape",
  "Wavy",
  "Weird",
  "Wet Letter",
  "Whimsy",
  "WideTerm",
  "Wow",
  "babyface-lame",
  "babyface-leet",
  "miniwi",
  "tmplr",
];
