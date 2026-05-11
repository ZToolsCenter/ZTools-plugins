import { useRef, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Spinner,
  Chip,
  Select,
  SelectItem,
  Tooltip,
  Input,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useTheme } from "next-themes";
import jwt from "jsonwebtoken";

import MonacoEditor, {
  MonacoJsonEditorRef,
} from "@/components/monacoEditor/MonacoJsonEditor.tsx";
import ToolboxPageTemplate from "@/layouts/toolboxPageTemplate";
import { parseJson, stringifyJson } from "@/utils/json";

interface JwtPayload {
  exp?: number;
  nbf?: number;
  [key: string]: any;
}

// JWT 编码函数
const encodeJwt = async (
  header: object,
  payload: object,
  secret: string,
  algorithm: string,
) => {
  try {
    // 确保 header 中的 alg 与选择的算法一致，但保留其他自定义字段
    const updatedHeader: Record<string, any> = { ...header, alg: algorithm };

    // 如果没有指定typ，添加默认的JWT类型
    if (!("typ" in updatedHeader)) {
      updatedHeader.typ = "JWT";
    }

    // 检查payload是否有效
    if (!payload || typeof payload !== "object") {
      throw new Error("无效的payload格式");
    }

    // 使用 jsonwebtoken 库签发 token
    const token = jwt.sign(payload, secret, {
      algorithm: algorithm as jwt.Algorithm,
      header: updatedHeader,
    });

    return token;
  } catch (error) {
    console.error("JWT 编码错误:", error);
    throw error;
  }
};

// JWT 解码函数
const decodeJwt = (token: string) => {
  try {
    if (!token || token.trim() === "") {
      return {
        header: null,
        payload: null,
        isValid: false,
        error: "空JWT令牌",
      };
    }

    // 分割 JWT 令牌
    const parts = token.split(".");

    if (parts.length !== 3) {
      return {
        header: null,
        payload: null,
        isValid: false,
        error: "无效的JWT格式，应包含三个部分",
      };
    }

    // 使用 jsonwebtoken 解码而不验证签名
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded) {
      return {
        header: null,
        payload: null,
        isValid: false,
        error: "JWT解析失败",
      };
    }

    return {
      header: decoded.header,
      payload: decoded.payload,
      isValid: true,
      error: null,
    };
  } catch (error) {
    console.error("JWT 解析错误:", error);

    return {
      header: null,
      payload: null,
      isValid: false,
      error: "JWT解析失败",
    };
  }
};

// 验证 JWT 签名
const verifyJwtSignature = async (token: string, secret: string) => {
  try {
    const parts = token.split(".");

    if (parts.length !== 3) {
      return { isValid: false, message: "无效的JWT格式，应包含三个部分" };
    }

    // 解码以获取头部信息和算法
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.header) {
      return { isValid: false, message: "无效的JWT格式" };
    }

    const algorithm = decoded.header.alg;

    // 支持的算法
    const supportedAlgs = [
      "HS256",
      "HS384",
      "HS512",
      "RS256",
      "RS384",
      "RS512",
      "ES256",
      "ES384",
      "ES512",
      "PS256",
      "PS384",
      "PS512",
    ];

    if (!supportedAlgs.includes(algorithm)) {
      return {
        isValid: false,
        message: `不支持的算法: ${algorithm}，支持的算法: ${supportedAlgs.join(", ")}`,
      };
    }

    // 检查非对称算法的密钥格式
    const isAsymmetricAlg = [
      "RS256",
      "RS384",
      "RS512",
      "ES256",
      "ES384",
      "ES512",
      "PS256",
      "PS384",
      "PS512",
    ].includes(algorithm);

    if (isAsymmetricAlg && !secret.includes("-----BEGIN")) {
      return {
        isValid: false,
        message: "非对称算法验证需要有效的密钥格式，如 PEM 格式",
      };
    }

    try {
      // 使用 jsonwebtoken 验证令牌
      const verified = jwt.verify(token, secret, {
        algorithms: [algorithm as jwt.Algorithm],
      });

      // 验证时间相关的字段
      const payload = verified as JwtPayload;
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && now > payload.exp) {
        return { isValid: false, message: "JWT已过期", algorithm };
      }

      if (payload.nbf && now < payload.nbf) {
        return { isValid: false, message: "JWT尚未生效", algorithm };
      }

      return {
        isValid: true,
        message: `JWT签名有效${payload?.exp ? "、时间有效" : ""}. 算法是: ${algorithm}`,
        algorithm,
      };
    } catch (err) {
      // 根据错误消息判断错误类型，而不是使用instanceof
      const errorMessage = (err as Error).message || "";

      if (errorMessage.includes("invalid signature")) {
        return { isValid: false, message: "JWT签名验证失败", algorithm };
      } else if (errorMessage.includes("jwt expired")) {
        return { isValid: false, message: "JWT已过期", algorithm };
      } else if (errorMessage.includes("not active")) {
        return { isValid: false, message: "JWT尚未生效", algorithm };
      } else {
        return {
          isValid: false,
          message: `验证失败: ${errorMessage}`,
          algorithm,
        };
      }
    }
  } catch (error) {
    console.error("验证错误:", error);

    return { isValid: false, message: `验证失败: ${(error as Error).message}` };
  }
};

export default function JwtParsePage() {
  const { theme } = useTheme();

  // 编辑器引用
  const jwtEditorRef = useRef<MonacoJsonEditorRef>(null);
  const headerEditorRef = useRef<MonacoJsonEditorRef>(null);
  const payloadEditorRef = useRef<MonacoJsonEditorRef>(null);
  const encodeHeaderEditorRef = useRef<MonacoJsonEditorRef>(null);
  const encodePayloadEditorRef = useRef<MonacoJsonEditorRef>(null);

  // 状态管理
  const [jwtToken, setJwtToken] = useState<string>("");
  const [headerJson, setHeaderJson] = useState<string>("");
  const [payloadJson, setPayloadJson] = useState<string>("");
  const [encodeHeaderJson, setEncodeHeaderJson] = useState<string>(
    stringifyJson({ alg: "HS256", typ: "JWT" }, 2),
  );
  const [encodePayloadJson, setEncodePayloadJson] = useState<string>(
    stringifyJson(
      {
        sub: "1234567890",
        name: "示例用户",
        iat: Math.floor(Date.now() / 1000),
      },
      2,
    ),
  );
  const [secret, setSecret] = useState<string>("");
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);
  const [validationMessage, setValidationMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>("HS256");

  // 解析 JWT
  const parseJwt = () => {
    if (!jwtToken) {
      setIsTokenValid(false);
      setValidationMessage("请输入 JWT 令牌");

      return;
    }

    setIsProcessing(true);

    try {
      const { header, payload, isValid, error } = decodeJwt(jwtToken);

      if (!isValid || !header || !payload) {
        setIsTokenValid(false);
        setValidationMessage(error || "无效的 JWT 格式");
        setIsProcessing(false);

        return;
      }

      // 更新编辑器内容
      const formattedHeader = stringifyJson(header, 2);
      const formattedPayload = stringifyJson(payload, 2);

      setHeaderJson(formattedHeader);
      setPayloadJson(formattedPayload);

      headerEditorRef.current?.updateValue(formattedHeader);
      payloadEditorRef.current?.updateValue(formattedPayload);

      // 设置为警告状态
      setIsTokenValid(null);
      setValidationMessage(
        "JWT 格式有效，这似乎是一个正确签名的JWT，需进一步校验。",
      );
    } catch (error) {
      // 安全地获取错误消息
      const errorMsg =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "未知错误";

      console.error("解析错误:", error);
      setIsTokenValid(false);
      setValidationMessage(`解析失败: ${errorMsg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 验证 JWT
  const verifyJwt = async () => {
    if (!jwtToken) {
      setIsTokenValid(false);
      setValidationMessage("请输入 JWT 令牌");

      return;
    }

    if (!secret) {
      setIsTokenValid(false);
      setValidationMessage("请输入密钥");

      return;
    }

    setIsProcessing(true);

    try {
      // 检查令牌格式
      const parts = jwtToken.split(".");

      if (parts.length !== 3) {
        setIsTokenValid(false);
        setValidationMessage("无效的JWT格式，应包含三个部分");

        return;
      }

      // 解析头部获取算法
      const decoded = jwt.decode(jwtToken, { complete: true });

      if (!decoded || !decoded.header || !decoded.header.alg) {
        setIsTokenValid(false);
        setValidationMessage("无法解析JWT头部");

        return;
      }

      const result = await verifyJwtSignature(jwtToken, secret);

      setIsTokenValid(result.isValid);
      setValidationMessage(result.message);
    } catch (error) {
      // 安全地获取错误消息
      const errorMsg =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "未知错误";

      console.error("验证错误:", error);
      setIsTokenValid(false);
      setValidationMessage(`验证失败: ${errorMsg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 编码 JWT
  const encodeJwtToken = async () => {
    if (!secret) {
      setIsTokenValid(false);
      setValidationMessage("请输入密钥");

      return;
    }

    setIsProcessing(true);

    try {
      // 检查解码区域是否有内容，如果有，优先使用解码区域的内容进行编码
      let useHeaderJson = encodeHeaderJson;
      let usePayloadJson = encodePayloadJson;

      // 如果解码区域有内容，优先使用解码区域的内容
      if (headerJson && payloadJson) {
        useHeaderJson = headerJson;
        usePayloadJson = payloadJson;

        // 更新编码区域的内容，保持UI一致性
        setEncodeHeaderJson(headerJson);
        setEncodePayloadJson(payloadJson);
        encodeHeaderEditorRef.current?.updateValue(headerJson);
        encodePayloadEditorRef.current?.updateValue(payloadJson);
      }

      // 解析 header 和 payload
      let header, payload;

      try {
        header = parseJson(useHeaderJson);
        payload = parseJson(usePayloadJson);
      } catch (e) {
        const errorMsg =
          e && typeof e === "object" && "message" in e
            ? String(e.message)
            : "未知错误";

        setIsTokenValid(false);
        setValidationMessage(`无效的 JSON 格式: ${errorMsg}`);
        setIsProcessing(false);

        return;
      }

      // 确保 header 中的 alg 与选择的算法一致
      header.alg = selectedAlgorithm;

      // 检查算法类型是否匹配密钥类型
      const isAsymmetricAlg = [
        "RS256",
        "RS384",
        "RS512",
        "ES256",
        "ES384",
        "ES512",
        "PS256",
        "PS384",
        "PS512",
      ].includes(selectedAlgorithm);

      // 检查非对称算法的私钥是否合法
      if (isAsymmetricAlg) {
        // 简单检查私钥格式，对于非对称算法，密钥通常是PEM格式
        if (!secret.includes("-----BEGIN") || !secret.includes("KEY-----")) {
          setIsTokenValid(false);
          setValidationMessage("非对称算法需要有效的私钥格式，如 PEM 格式");
          setIsProcessing(false);

          return;
        }
      }

      try {
        // 生成 JWT
        const token = await encodeJwt(
          header,
          payload,
          secret,
          selectedAlgorithm,
        );

        // 更新界面
        setJwtToken(token);
        jwtEditorRef.current?.updateValue(token);

        // 自动解析新生成的 token
        setIsTokenValid(true);
        setValidationMessage("JWT 生成成功");

        // 自动解析
        const { header: parsedHeader, payload: parsedPayload } =
          decodeJwt(token);

        if (parsedHeader && parsedPayload) {
          // 更新编辑器内容
          const formattedHeader = stringifyJson(parsedHeader, 2);
          const formattedPayload = stringifyJson(parsedPayload, 2);

          setHeaderJson(formattedHeader);
          setPayloadJson(formattedPayload);

          headerEditorRef.current?.updateValue(formattedHeader);
          payloadEditorRef.current?.updateValue(formattedPayload);
        }
      } catch (err) {
        // 安全地获取错误消息
        const errMsg =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : "未知错误";

        if (isAsymmetricAlg && errMsg.includes("key")) {
          setIsTokenValid(false);
          setValidationMessage(
            `编码失败: 非对称算法需要有效的私钥格式，如 PEM 格式`,
          );
        } else {
          setIsTokenValid(false);
          setValidationMessage(`编码失败: ${errMsg}`);
        }
      }
    } catch (error) {
      // 安全地获取错误消息
      const errorMsg =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "未知错误";

      console.error("编码错误:", error);
      setIsTokenValid(false);
      setValidationMessage(`编码失败: ${errorMsg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 重置函数
  const handleReset = () => {
    setJwtToken("");
    setHeaderJson("");
    setPayloadJson("");
    setSecret("");
    setIsTokenValid(null);
    setValidationMessage("");
    jwtEditorRef.current?.updateValue("");
    headerEditorRef.current?.updateValue("");
    payloadEditorRef.current?.updateValue("");

    // 重置编码区域为默认值
    const defaultHeader = stringifyJson(
      { alg: selectedAlgorithm, typ: "JWT" },
      2,
    );
    const defaultPayload = stringifyJson(
      {
        sub: "1234567890",
        name: "示例用户",
        iat: Math.floor(Date.now() / 1000),
      },
      2,
    );

    setEncodeHeaderJson(defaultHeader);
    setEncodePayloadJson(defaultPayload);
    encodeHeaderEditorRef.current?.updateValue(defaultHeader);
    encodePayloadEditorRef.current?.updateValue(defaultPayload);

    setIsTokenValid(true);
    setValidationMessage("内容已清空");
  };

  // 复制 JWT
  const copyJwt = () => {
    if (!jwtToken) {
      setIsTokenValid(false);
      setValidationMessage("暂无内容可复制");

      return;
    }

    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(jwtToken)
        .then(() => {
          setIsTokenValid(true);
          setValidationMessage("已复制到剪贴板");
        })
        .catch(() => {
          setIsTokenValid(false);
          setValidationMessage("复制失败");
        });
    } else {
      setIsTokenValid(false);
      setValidationMessage("复制失败");
    }
  };

  // 随机示例 JWT
  const generateSampleJwt = () => {
    // 设置示例header和payload
    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    // 使用当前时间戳作为iat，确保每次生成的JWT都不同
    const payload = {
      username: "json-tools",
      sub: "demo",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30天后过期
    };

    // 设置密钥
    const sampleSecret = "json-tools";

    setSecret(sampleSecret);

    // 更新编辑器内容
    const headerStr = stringifyJson(header, 2);
    const payloadStr = stringifyJson(payload, 2);

    setEncodeHeaderJson(headerStr);
    setEncodePayloadJson(payloadStr);
    encodeHeaderEditorRef.current?.updateValue(headerStr);
    encodePayloadEditorRef.current?.updateValue(payloadStr);

    // 生成JWT
    encodeJwt(header, payload, sampleSecret, "HS256")
      .then((token) => {
        setJwtToken(token);
        jwtEditorRef.current?.updateValue(token);

        // 解析生成的JWT
        const { header: parsedHeader, payload: parsedPayload } =
          decodeJwt(token);

        if (parsedHeader && parsedPayload) {
          const formattedHeader = stringifyJson(parsedHeader, 2);
          const formattedPayload = stringifyJson(parsedPayload, 2);

          setHeaderJson(formattedHeader);
          setPayloadJson(formattedPayload);

          headerEditorRef.current?.updateValue(formattedHeader);
          payloadEditorRef.current?.updateValue(formattedPayload);
        }

        setIsTokenValid(true);
        setValidationMessage("已生成新的示例 JWT");
      })
      .catch((error) => {
        console.error("生成示例JWT失败:", error);
        setIsTokenValid(false);
        setValidationMessage("生成示例JWT失败");
      });
  };

  // JWT提示信息
  const jwtHelpInfo =
    "JWT（JSON Web Token）结构说明：\n\n" +
    "1. 头部(Header)：包含token类型和算法\n" +
    "2. 载荷(Payload)：包含声明信息\n" +
    "3. 签名(Signature)：验证发送者身份和消息完整性\n\n" +
    "JWT格式：xxxxx.yyyyy.zzzzz（点号分隔的三部分）";

  const headerHelpInfo =
    "头部(Header)字段说明：\n\n" +
    "alg：签名算法（如HS256, RS256等）\n" +
    "typ：令牌类型，通常为JWT\n" +
    "kid：密钥ID（可选）\n" +
    "jku：密钥集URL（可选）\n" +
    "x5u：X.509证书URL（可选）";

  const payloadHelpInfo =
    "载荷(Payload)常用字段：\n\n" +
    "iss：签发者\n" +
    "sub：主题/用户ID\n" +
    "aud：接收方\n" +
    "exp：过期时间（UNIX时间戳）\n" +
    "nbf：生效时间（Not Before）\n" +
    "iat：签发时间（Issued At）\n" +
    "jti：JWT唯一标识符";

  return (
    <ToolboxPageTemplate
      toolIcon="solar:document-lock-linear"
      toolIconColor="text-primary"
      toolName="JWT 解析与验证"
    >
      <div className="flex flex-col h-full">
        {/* 解码/验证界面 */}
        <div className="flex flex-col md:flex-row h-full gap-4">
          {/* 编码区域 - JWT 输入 */}
          <Card className="flex-1 shadow-md border border-default-200 transition-shadow hover:shadow-lg">
            <CardBody className="p-0 h-full flex flex-col">
              <div className="px-2.5 py-1  bg-default-50 border-b border-default-200 flex justify-between items-center">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Icon
                    className="text-default-600"
                    icon="solar:key-minimalistic-outline"
                    width={16}
                  />
                  编码区域
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip
                    className="max-w-xs"
                    classNames={{
                      content: "text-left whitespace-pre-line",
                    }}
                    content={jwtHelpInfo}
                    placement="top"
                  >
                    <Button
                      isIconOnly
                      aria-label="帮助"
                      className="bg-default-100/50 hover:bg-default-200/60"
                      size="sm"
                      variant="light"
                    >
                      <Icon
                        className="text-default-600"
                        icon="solar:question-circle-outline"
                        width={18}
                      />
                    </Button>
                  </Tooltip>
                  <Tooltip content="复制" placement="top">
                    <Button
                      isIconOnly
                      aria-label="复制"
                      className="bg-default-100/50 hover:bg-default-200/60"
                      size="sm"
                      variant="light"
                      onPress={copyJwt}
                    >
                      <Icon
                        className="text-default-600"
                        icon="solar:copy-outline"
                        width={18}
                      />
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <div className="flex-1 p-0 overflow-hidden">
                <MonacoEditor
                  ref={jwtEditorRef}
                  height="100%"
                  language="shell"
                  tabKey="jwt"
                  theme={theme === "dark" ? "vs-dark" : "vs-light"}
                  value={jwtToken}
                  onUpdateValue={(value) => setJwtToken(value || "")}
                />
              </div>
            </CardBody>
          </Card>

          {/* 操作区域 */}
          <Card className="flex-1 shadow-md border border-default-200 transition-shadow hover:shadow-lg">
            <CardBody className="p-0 h-full flex flex-col">
              <div className="p-2.5 bg-default-50 border-b border-default-200 flex justify-between items-center">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Icon
                    className="text-default-600"
                    icon="solar:settings-minimalistic-outline"
                    width={16}
                  />
                  操作区域
                </span>
                <div className="flex items-center gap-1">
                  {/* 添加空白区域，保持与其他标题样式一致 */}
                </div>
              </div>

              <div className="flex flex-col gap-4 p-4">
                <Select
                  aria-label="签名算法"
                  className="w-full"
                  color="primary"
                  label="签名算法"
                  selectedKeys={[selectedAlgorithm]}
                  size="md"
                  startContent={
                    <Icon
                      className="mr-1 text-primary"
                      icon="solar:lock-outline"
                      width={18}
                    />
                  }
                  variant="bordered"
                  onChange={(e) => {
                    setSelectedAlgorithm(e.target.value);
                    // 更新 header 中的 alg 字段
                    try {
                      const header = parseJson(encodeHeaderJson);

                      header.alg = e.target.value;
                      const updatedHeader = stringifyJson(header, 2);

                      setEncodeHeaderJson(updatedHeader);
                      encodeHeaderEditorRef.current?.updateValue(updatedHeader);
                    } catch (err) {
                      console.error("解析 header 失败", err);
                    }
                  }}
                >
                  <SelectItem key="HS256">HS256</SelectItem>
                  <SelectItem key="HS384">HS384</SelectItem>
                  <SelectItem key="HS512">HS512</SelectItem>
                  <SelectItem key="RS256">RS256</SelectItem>
                  <SelectItem key="RS384">RS384</SelectItem>
                  <SelectItem key="RS512">RS512</SelectItem>
                  <SelectItem key="ES256">ES256</SelectItem>
                  <SelectItem key="ES384">ES384</SelectItem>
                  <SelectItem key="ES512">ES512</SelectItem>
                  <SelectItem key="PS256">PS256</SelectItem>
                  <SelectItem key="PS384">PS384</SelectItem>
                  <SelectItem key="PS512">PS512</SelectItem>
                </Select>

                <Input
                  aria-label="密钥"
                  className="w-full"
                  color="primary"
                  label="密钥"
                  placeholder="输入用于签名的密钥"
                  size="md"
                  value={secret}
                  variant="bordered"
                  onChange={(e) => setSecret(e.target.value)}
                />
                {[
                  "RS256",
                  "RS384",
                  "RS512",
                  "ES256",
                  "ES384",
                  "ES512",
                  "PS256",
                  "PS384",
                  "PS512",
                ].includes(selectedAlgorithm) && (
                  <div className="mt-1 text-xs text-default-400">
                    注意：非对称算法（RS*/ES*/PS*）签名需要私钥
                  </div>
                )}

                <div className="flex flex-col gap-2 mt-4">
                  <Button
                    fullWidth
                    className="font-medium"
                    color="primary"
                    isDisabled={isProcessing}
                    size="lg"
                    startContent={
                      isProcessing ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        <Icon icon="solar:code-square-outline" width={18} />
                      )
                    }
                    variant="flat"
                    onPress={parseJwt}
                  >
                    解码 JWT
                  </Button>

                  <Button
                    fullWidth
                    className="font-medium"
                    color="secondary"
                    isDisabled={isProcessing || !secret}
                    size="lg"
                    startContent={
                      isProcessing ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        <Icon icon="solar:check-square-linear" width={18} />
                      )
                    }
                    variant="flat"
                    onPress={verifyJwt}
                  >
                    校验一下
                  </Button>

                  <Button
                    fullWidth
                    className="font-medium"
                    color="success"
                    isDisabled={isProcessing}
                    size="lg"
                    startContent={
                      <Icon icon="solar:file-download-outline" width={18} />
                    }
                    variant="flat"
                    onPress={encodeJwtToken}
                  >
                    生成 JWT
                  </Button>

                  <Button
                    fullWidth
                    className="font-medium"
                    color="default"
                    size="lg"
                    startContent={<Icon icon="cuida:lamp-outline" width={18} />}
                    variant="flat"
                    onPress={generateSampleJwt}
                  >
                    来个Demo
                  </Button>

                  <Button
                    fullWidth
                    className="font-medium"
                    color="danger"
                    isDisabled={isProcessing}
                    size="lg"
                    startContent={
                      <Icon icon="solar:restart-outline" width={18} />
                    }
                    variant="flat"
                    onPress={handleReset}
                  >
                    重置内容
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* 解码区域 */}
          <Card className="flex-1 shadow-md border border-default-200 transition-shadow hover:shadow-lg">
            <CardBody className="p-0 h-full flex flex-col">
              <div className="p-2.5 bg-default-50 border-b border-default-200 flex justify-between items-center">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Icon
                    className="text-default-600"
                    icon="solar:document-text-outline"
                    width={16}
                  />
                  解码区域
                </span>
              </div>

              <div className="flex flex-col h-full overflow-auto">
                {/* 头部/Header */}
                <div className="p-3 border-b border-default-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Icon
                        className="text-default-600"
                        icon="solar:document-text-outline"
                        width={16}
                      />
                      头部/Header
                    </span>
                    <div className="flex items-center gap-1">
                      <Tooltip
                        className="max-w-xs"
                        classNames={{
                          content: "text-left whitespace-pre-line",
                        }}
                        content={headerHelpInfo}
                        placement="top"
                      >
                        <Button
                          isIconOnly
                          aria-label="帮助"
                          className="bg-default-100/50 hover:bg-default-200/60"
                          size="sm"
                          variant="light"
                        >
                          <Icon
                            className="text-default-600"
                            icon="solar:question-circle-outline"
                            width={18}
                          />
                        </Button>
                      </Tooltip>
                      <Button
                        isIconOnly
                        aria-label="复制"
                        className="bg-default-100/50 hover:bg-default-200/60"
                        size="sm"
                        variant="light"
                        onPress={() => {
                          if (headerJson) {
                            navigator.clipboard.writeText(headerJson);
                            setValidationMessage("已复制头部到剪贴板");
                          }
                        }}
                      >
                        <Icon
                          className="text-default-600"
                          icon="solar:copy-outline"
                          width={18}
                        />
                      </Button>
                    </div>
                  </div>
                  <div className="h-[150px] overflow-hidden">
                    <MonacoEditor
                      ref={headerEditorRef}
                      height="150px"
                      language="json"
                      tabKey="header"
                      theme={theme === "dark" ? "vs-dark" : "vs-light"}
                      value={headerJson}
                      onUpdateValue={(value) => setHeaderJson(value || "")}
                    />
                  </div>
                </div>

                {/* 载荷/Payload */}
                <div className="p-3 border-b border-default-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Icon
                        className="text-default-600"
                        icon="solar:server-outline"
                        width={16}
                      />
                      载荷/Payload
                    </span>
                    <div className="flex items-center gap-1">
                      <Tooltip
                        className="max-w-xs"
                        classNames={{
                          content: "text-left whitespace-pre-line",
                        }}
                        content={payloadHelpInfo}
                        placement="top"
                      >
                        <Button
                          isIconOnly
                          aria-label="帮助"
                          className="bg-default-100/50 hover:bg-default-200/60"
                          size="sm"
                          variant="light"
                        >
                          <Icon
                            className="text-default-600"
                            icon="solar:question-circle-outline"
                            width={18}
                          />
                        </Button>
                      </Tooltip>
                      <Button
                        isIconOnly
                        aria-label="复制"
                        className="bg-default-100/50 hover:bg-default-200/60"
                        size="sm"
                        variant="light"
                        onPress={() => {
                          if (payloadJson) {
                            navigator.clipboard.writeText(payloadJson);
                            setValidationMessage("已复制载荷到剪贴板");
                          }
                        }}
                      >
                        <Icon
                          className="text-default-600"
                          icon="solar:copy-outline"
                          width={18}
                        />
                      </Button>
                    </div>
                  </div>
                  <div className="h-[150px] overflow-hidden">
                    <MonacoEditor
                      ref={payloadEditorRef}
                      height="150px"
                      language="json"
                      tabKey="payload"
                      theme={theme === "dark" ? "vs-dark" : "vs-light"}
                      value={payloadJson}
                      onUpdateValue={(value) => setPayloadJson(value || "")}
                    />
                  </div>
                </div>

                {/* 签名验证结果 */}
                <div className="p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Icon
                        className="text-default-600"
                        icon="solar:lock-keyhole-minimalistic-outline"
                        width={16}
                      />
                      签名验证
                    </span>
                  </div>
                  {validationMessage && (
                    <div className="flex flex-col w-full">
                      <Chip
                        className="px-3 py-2 h-auto min-h-[40px] text-left"
                        classNames={{
                          base: "break-words",
                          content: "whitespace-pre-line break-words w-full",
                        }}
                        color={
                          isTokenValid === true
                            ? "success"
                            : isTokenValid === false
                              ? "danger"
                              : "warning"
                        }
                        startContent={
                          isTokenValid === true ? (
                            <Icon
                              className="mx-1 flex-shrink-0"
                              icon="icon-park-outline:success"
                              width={18}
                            />
                          ) : isTokenValid === false ? (
                            <Icon
                              className="mx-1 flex-shrink-0"
                              icon="icon-park-outline:close"
                              width={18}
                            />
                          ) : (
                            <Icon
                              className="mx-1 flex-shrink-0"
                              icon="icon-park-outline:attention"
                              width={18}
                            />
                          )
                        }
                        variant="flat"
                      >
                        {validationMessage}
                      </Chip>
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </ToolboxPageTemplate>
  );
}
