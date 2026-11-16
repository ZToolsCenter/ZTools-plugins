'use strict';
function createPipe(input,onError){let failed=false;function fail(error){if(!failed){failed=true;onError(error)}}input.on('error',fail);return {send(message){if(failed||!input.writable)return false;try{input.write(JSON.stringify(message)+'\n',error=>{if(error)fail(error)});return true}catch(error){fail(error);return false}}}}
module.exports={createPipe};
