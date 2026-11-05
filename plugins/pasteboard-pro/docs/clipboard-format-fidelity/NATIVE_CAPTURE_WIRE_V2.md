# Native capture wire v2 — codec evidence

v0.18实现快照。保留[v1约束](NATIVE_CAPTURE_WIRE.md)，新增原生codec事实；仍仅限受监督固定公开fixture，不是production host/持久化/回放API。v1 reader保持strict，不接受v2；新版neutral reader明确识别v1/v2，绝不把v2额外字段静默当v1丢弃。

## Frame and codec

v2 magic为8-byte `PBCAP02\n`，metadata.schemaVersion=2，其余prefix/长度/JSON/revision/预算/row顺序与v1一致。每条captured row必须有nativeCodec；unavailable row不得有。v1 writer拒绝带nativeCodec输入，防止静默丢证据。新版mapper提供neutral mapNativeCaptureWire，以及strict v1/v2 wrappers。

```json
{"encoding":"utf16-external-bytes","materialization":"owned-pasteboard-data","text":{"encoding":"utf-16be","byteOrderMark":false,"nullTerminated":true,"encodingCheck":"decoded-text-matches"}}
```

nativeCodec字段：encoding/materialization为1—128 ASCII identifier chars `[A-Za-z0-9._:-]+`，可选validationCodePage为1—65535整数（仅Windows，保留helper验证上下文，不声称producer编码）。text可选，仅macOS public.utf16-external-plain-text允许，且row必须为compatible、derivedFrom同item captured public.utf8-plain-text；没有text证据则只能为exact且无derivedFrom。text字段严格为encoding（utf-16le/utf-16be）、byteOrderMark、nullTerminated、encodingCheck（decoded-text-matches/canonical-unicode-equivalent）。不从末尾字节猜这个标志。

Windows直接保留FormatPayload.encoding/materialization/validation_code_page，不用收据归一化值替换；例如windows-acp-url-1252要保留页码后缀。Mac使用真实格式描述encoding：UTF8/TSV/URL/fileURL为utf-8，HTML为html-utf8，RTF为rtf-bytes，UTF16为utf16-external-bytes，PNG/JPEG/TIFF分别png-bytes/jpeg-bytes/tiff-bytes，安全颜色archive为nscolor-secure-archive；materialization为owned-pasteboard-data。UTF16 text证据只从owned Capture DTO已有的byteOrder/byteOrderMark/nullTerminated/encodingCheck复制，不能重新猜测；standalone UTF16没有分析证据时可保留raw exact，但不能伪造证据。

## Admission binding

Node严格保留nativeCodec，并校验platform/nativeName/known encoding/materialization一致。Mac text证据还必须用对应owned UTF8源重新验证：字节长度/UTF16奇偶、BOM与byteOrderMark/encoding一致、nullTerminated=true时确有末尾零码元；只剥明示的一个终止码元用于比较；解码必须fatal。decoded-text-matches必须严格相等，canonical-unicode-equivalent必须NFC相等。BOM按证据只移除明确的两个UTF16头字节，UTF8源遵循原生NSString解码语义，以实际native fixture冻结。证据不一致拒绝frame；剥除声明的BOM后至少有一个UTF-16码元，空或只有BOM的证据不能通过。单个明确终止码元可与空UTF-8源对应。不改变raw bytes/hash/fidelity/derivedFrom。

v1和v2无text证据的外部UTF16仍仅能用明确BOM定字节序、termination:none；含NUL不报passed。v2有效证据可明确termination并支持BOM-less byte order；正文实际NUL（nullTerminated=false）仍保持未完成扫描，不能被另一个alias绕过。默认fixture覆盖现有多item；新增固定nul-content、terminated和bomless-be公开fixture用于实际原生证据路径。所有模式都拒绝无监督或非RUN token，不访问general board。

已知native格式即使没有可验证ScanCodecV2，也保留captured raw身份；内容规则开启时返回not-scanned且不准留存，关闭时可按allowlist保留原件并仍标not-scanned。正文NUL的alias阻断继续有效。未知nativeName仍为unavailable，不能靠关闭内容规则升级。

## CF_HTML

Windows HTML Format是UTF-8的CF_HTML容器，offset按原始byte计算，不是字符下标。独立bounded parser同时用于Windows native validation与Node Worker；只做静态验证，不执行HTML、不请求SourceURL。raw上限8MiB，header上限4096 bytes/128 lines（包括终止空行），支持Version 0.9/1.0、CRLF/LF/CR、十进制leading zero、StartHTML=EndHTML=-1无context、成对可选selection和SourceURL/有界unknown header。重复字段、数字垃圾/overflow、offset越界/打断UTF8、混合-1、marker与offset不一致、无法解释的非零尾部拒绝。已知marker按声明offset附近验证，不按第一次find猜位置。native逻辑长度只去掉allocation零padding，保留可解释的尾部空白；Node扫描只接受完整逻辑payload，无额外padding/尾帧。

Worker扫描整个HTML context（无context则fragment），不能只扫被选子串而跳过隐藏/前后文。完整raw header/source也检查；SourceURL及header值的bounded percent/entity投影检查同当前URL规则。有效静态HTML可能passed；外部内容/动态/CSS未知仍not-scanned；已知match仍拒绝整copy，畸形container不得计passed。新增ScanCodecV2.htmlContainer只允许html+rich-text、encoding=utf-8、termination=none；CF_HTML codec只由Windows native registry选择，不由MIME/renderer指定。v2 Windows要求nativeCodec.encoding=cf-html-offset-format且materialization=current-clipboard-format-bytes；v1可按既有native格式身份选择CF_HTML但不会凭metadata伪造UTF8。

依据：[Microsoft CF_HTML](https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format)。Windows SDK/API/真实目标应用仍NOT-RUN，不由portable parser或Node测试标支持。

RTF v0.19 scanner: [RTF privacy projection](RTF_PRIVACY_PROJECTION.md). 脚注、批注、页眉/页脚目的地先按 Microsoft 约定恢复默认字体、清除继承的显式 codepage/隐藏状态；非默认继承 uc 暂不能声明完整。注释辅助目的地 atnauthor/atnid/atndate 的整体结构尚未建模，保持 incomplete，不因孤立组可读就批准。
