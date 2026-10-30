/* Protocol validity is distinct from the 33ms performance threshold. */
module.exports=function assessPanProtocol(trajectory){
  const duration=trajectory?.duration_ms;
  return {valid:Number.isFinite(duration)&&duration>=29000&&duration<=35000,
    expected_duration_ms:30000,accepted_duration_ms:[29000,35000],observed_duration_ms:duration,
    reason:Number.isFinite(duration)&&duration>=29000&&duration<=35000?null:'Observed capture does not match the fixed continuous 30-second protocol; preserve raw data and investigate interruption/stall.'};
};
