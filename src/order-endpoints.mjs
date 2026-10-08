// Read-only description of supplier capabilities, never a supplier order request.
export function supplierOrderEndpointStatus() {
  const flag=k=>String(process.env[k]||'').toLowerCase()==='true';
  const master=flag('FULFILLMENT_LIVE_SUBMISSION_ENABLED');
  const entries=[
    ['Gelato','POST https://order.gelatoapis.com/v4/orders','GELATO_FULFILLMENT_ENABLED',true,true],
    ['Printify','POST /v1/shops/{shopId}/orders.json','PRINTIFY_FULFILLMENT_ENABLED',true,true],
    ['Prodigi','POST /v4.0/orders','PRODIGI_FULFILLMENT_ENABLED',true,true],
    ['Artelo','POST /orders/create','ARTELO_FULFILLMENT_ENABLED',true,true],
    ['PrintShrimp','POST /api-create-order','PRINTSHRIMP_FULFILLMENT_ENABLED',true,true],
    ['Sensaria','Sensaria GO CSV export and shipment report CSV',null,false,false]
  ];
  return {masterLiveSubmissionEnabled:master,
    etsyTrackingSubmissionEnabled:flag('ETSY_SHIPMENT_SUBMISSION_ENABLED'),
    etsyTrackingApiApprovalMustBeVerified:true,
    suppliers:entries.map(([name,endpoint,setting,apiAvailable,orderLookupApiAvailable])=>({
      name,endpoint,apiAvailable,orderLookupApiAvailable,
      submissionFlagEnabled:Boolean(setting)&&master&&flag(setting),
      orderSubmissionWorkflowConnected:false,
      readyForUnattendedOrders:false
    }))
  };
}
