'use strict';
const {fail}=require('./model');
// Technical framing validation, not speech-quality or semantic validation.
function validateMp3(buffer){
 const v1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
 const v2=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
 let offset=0,frames=0;
 const invalid=()=>fail('The narrator returned malformed MP3 frames. No retry or format fallback was purchased.','AUDIO_INVALID_MEDIA',502);
 while(offset<buffer.length){
  if(buffer.subarray(offset,offset+3).toString()==='ID3'){
   if(offset+10>buffer.length)return invalid();const sizes=[...buffer.subarray(offset+6,offset+10)];if(sizes.some(value=>value>127))return invalid();const length=sizes.reduce((n,value)=>n*128+value,0);offset+=10+length+((buffer[offset+5]&16)?10:0);if(offset>buffer.length)return invalid();continue;
  }
  if(buffer.length-offset===128&&buffer.subarray(offset,offset+3).toString()==='TAG'){offset+=128;break;}
  if(offset+4>buffer.length||buffer[offset]!==255||(buffer[offset+1]&224)!==224)return invalid();
  const version=(buffer[offset+1]>>3)&3,layer=(buffer[offset+1]>>1)&3,rate=(buffer[offset+2]>>2)&3,bitrate=buffer[offset+2]>>4;
  if(version===1||layer!==1||rate===3||bitrate===0||bitrate===15)return invalid();
  const sample=[44100,48000,32000][rate]/(version===3?1:version===2?2:4);
  const size=Math.floor((version===3?144000:72000)*(version===3?v1:v2)[bitrate]/sample)+((buffer[offset+2]>>1)&1);
  if(size<4||offset+size>buffer.length)return invalid();offset+=size;frames++;
 }
 if(!frames)return invalid();return {frames};
}
module.exports={validateMp3};
