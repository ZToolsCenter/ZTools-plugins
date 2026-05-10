<?php

class solver{

		private $errorMessage;
		private $errorCode;
		public function execute($data) {

				$id = property_exists($data, "id")?$data->id:null;
				$pattern = $data->pattern;
				$modifiers = $data->flags;
				$text = $data->text;

				$globalIndex = strrpos($modifiers, 'g');
				if ($globalIndex !== false) {
						$global = true;
						$modifiers = str_replace('g', '', $modifiers);
				} else {
						$global = false;
				}

				$startTime = microtime(true)*1000;
				$matches = $this->pcreMatch($pattern, $modifiers, $global, $text);
				$endTime = microtime(true)*1000;;

				// Stop capturing warnings.
				restore_error_handler();

				$totalTime = floatval(number_format($endTime - $startTime, 4, '.', ''));

				$result = [
						'id' => $id,
						'timestamp' => time(),
						'time' => $totalTime,
						'matches' => $matches
				];

				if (!is_null($this->errorMessage) || !is_null($this->errorCode)) {
						$result['error'] = [
								'message' => $this->errorMessage,
								'name' => $this->getRegexErrorCodeString($this->errorCode),
								'id' => $this->pcreErrorCodeToJS($this->errorCode)
						];
                }
                return json_encode($result);
		}

		function pcreMatch($pattern, $modifiers, $global, $text) {
				$matches = [];
				$jsonMatches = [];

				if ($global === true) {
						$match = preg_match_all("/{$pattern}/{$modifiers}", $text, $matches, PREG_OFFSET_CAPTURE|PREG_SET_ORDER);
				} else {
						$match = preg_match("/{$pattern}/{$modifiers}", $text, $matches, PREG_OFFSET_CAPTURE);
				}

				if ($global === true && $match !== false) {
						for ($i=0;$i<count($matches);$i++) {
								$match = $matches[$i];
								$first = array_shift($match);
								$jsonMatches[] = $this->createMatchEntry($first, $match, $text);
						}
				} elseif ($match !== false) {
						$first = array_shift($matches);
						$jsonMatches[] = $this->createMatchEntry($first, $matches, $text);
				}

				return $jsonMatches;
		}

		function createMatchEntry($match, $groups, $text) {
				$result = [];

				$txt = $match[0];
				$index = intval($match[1]);
				$result['i'] = \mb_strlen(\mb_strcut($text, 0, $index));
				$result['l'] = \mb_strlen($txt, "UTF-8");
				$result['groups'] = [];

				foreach($groups as $key => $group) {
						if (is_int($key)) {
								$index = intval($group[1]);
								$matchResult = $group[0];
								$result['groups'][] = [
										'i' => \mb_strlen(\mb_strcut($text, 0, $index)),
										'l' => \mb_strlen($matchResult, "UTF-8")
								];
						}
				}
				return $result;
		}

		function pcreWarningHandler($errCode, $errstr) {
				$this->errorCode = $errCode;
				$this->errorMessage = preg_replace("/^[a-z_():\s]+/", "", $errstr);
		}

		function pcreErrorCodeToJS($code) {
				$errorId = null;
				switch ($code) {
						case PREG_INTERNAL_ERROR:
								$errorId = 'error';
								break;
						case PREG_BACKTRACK_LIMIT_ERROR:
						case PREG_RECURSION_LIMIT_ERROR:
						case PREG_JIT_STACKLIMIT_ERROR: // PHP 7.0 only
								$errorId = 'infinite';
								break;
						case PREG_BAD_UTF8_ERROR:
						case PREG_BAD_UTF8_OFFSET_ERROR:
								$errorId = 'badutf8';
								break;
						case PREG_NO_ERROR:
						default:
								break;
				}
				return $errorId;
		}

		function getRegexErrorCodeString($errorCode) {
				$stringCode = '';

				switch ($errorCode) {
						case PREG_INTERNAL_ERROR:
								$stringCode = 'PREG_INTERNAL_ERROR';
								break;
						case PREG_BACKTRACK_LIMIT_ERROR:
								$stringCode = 'PREG_BACKTRACK_LIMIT_ERROR';
								break;
						case PREG_RECURSION_LIMIT_ERROR:
								$stringCode = 'PREG_RECURSION_LIMIT_ERROR';
								break;
						case PREG_BAD_UTF8_ERROR:
								$stringCode = 'PREG_BAD_UTF8_ERROR';
								break;
						case PREG_BAD_UTF8_OFFSET_ERROR:
								$stringCode = 'PREG_BAD_UTF8_OFFSET_ERROR';
								break;
						// PHP 7.0
						case PREG_JIT_STACKLIMIT_ERROR:
								$stringCode = 'PREG_JIT_STACKLIMIT_ERROR';
								break;
						case PREG_NO_ERROR:
								default:
								break;
				}
				return $stringCode;
		}
}

echo (new solver())->execute(json_decode(urldecode($argv[1])));

?>
