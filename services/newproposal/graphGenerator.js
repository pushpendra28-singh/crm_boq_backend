exports.generateGraphs = (proposal) => {
  const subtotal =
    proposal.lineItems.reduce(
      (sum, item) =>
        sum +
        (item.qty || 0) *
          (item.unitPrice || 0),
      0
    );

  const discountAmt =
    (subtotal *
      (proposal.discount || 0)) /
    100;

  const taxAmt =
    ((subtotal - discountAmt) *
      (proposal.taxRate || 0)) /
    100;

  const total =
    subtotal -
    discountAmt +
    taxAmt;

  return {
    pricingChart: [
      {
        label: "Subtotal",
        value: subtotal,
      },
      {
        label: "Discount",
        value: discountAmt,
      },
      {
        label: "Tax",
        value: taxAmt,
      },
      {
        label: "Total",
        value: total,
      },
    ],

    milestoneChart:
      proposal.milestones?.map(
        (m, i) => ({
          step: i + 1,
          title: m.title,
        })
      ) || [],

    timelineChart:
      proposal.milestones?.map(
        (m) => ({
          label: m.title,
          date: m.dueDate,
        })
      ) || [],

    kpiChart: [
      {
        label: "Efficiency",
        value: 85,
      },
      {
        label: "ROI",
        value: 75,
      },
      {
        label: "Completion",
        value: 100,
      },
    ],
  };
};