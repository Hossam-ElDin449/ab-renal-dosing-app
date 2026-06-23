let doseData = [];
let calculatedCrCl = null;

// Load the dataset once when the page opens
fetch('data.json')
  .then(res => res.json())
  .then(data => {
    doseData = data;
    populateMedicationList();
  });

function populateMedicationList() {
  const meds = [...new Set(doseData.map(row => row.medication))].sort();
  const list = document.getElementById('medicationList');
  list.innerHTML = meds.map(m => `<option value="${m}">`).join('');
}

// Indication choices depend on which medication was typed
document.getElementById('medication').addEventListener('input', function () {
  const med = this.value.trim();
  const indications = [...new Set(
    doseData.filter(row => row.medication === med).map(row => row.indication)
  )].sort();
  document.getElementById('indicationList').innerHTML =
    indications.map(i => `<option value="${i}">`).join('');
});

function calculateCrCl() {
  const scrNow = parseFloat(document.getElementById('scr').value);
  const scrBeforeRaw = document.getElementById('scrBefore').value;
  const scrBefore = scrBeforeRaw ? parseFloat(scrBeforeRaw) : null;
  const age = parseFloat(document.getElementById('age').value);
  const weight = parseFloat(document.getElementById('weight').value);
  const heightCm = parseFloat(document.getElementById('height').value);
  const sex = document.getElementById('sex').value;

  const resultBox = document.getElementById('crclResult');

  if (!scrNow || !age || !weight || !heightCm) {
    resultBox.innerHTML = '<span class="error">Please fill Scr, age, weight, and height.</span>';
    calculatedCrCl = null;
    return;
  }

  // Step 1: choose which SCr to use (detect AKI if a 48h-ago value was given)
  let scrUsed = scrNow;
  let scrNote = '';
  if (scrBefore !== null && !isNaN(scrBefore)) {
    const rise = scrNow - scrBefore;
    if (rise > 0.3) {
      if (scrNow > scrBefore) {
        scrUsed = scrNow;
        scrNote = 'AKI detected (rise >0.3 mg/dL) — using current SCr';
      } else {
        scrUsed = (scrNow + scrBefore) / 2;
        scrNote = 'AKI detected (rise >0.3 mg/dL) — using average SCr';
      }
    }
  }

  // Step 2: choose which weight to use (BMI-based)
  const heightInches = heightCm / 2.54;
  const heightM = heightCm / 100;
  const bmi = weight / (heightM * heightM);

  // Devine formula for Ideal Body Weight; only valid for height > 60 inches (5 ft)
  let ibw = weight;
  if (heightInches > 60) {
    ibw = sex === 'female'
      ? 45.5 + 2.3 * (heightInches - 60)
      : 50 + 2.3 * (heightInches - 60);
  }

  let weightUsed = weight;
  let weightNote = `Actual body weight (BMI ${bmi.toFixed(1)})`;
  if (bmi >= 30) {
    weightUsed = ibw + 0.4 * (weight - ibw);
    weightNote = `Adjusted body weight (BMI ${bmi.toFixed(1)})`;
  }

  // Step 3: Cockcroft-Gault with chosen SCr and weight
  let crcl = ((140 - age) * weightUsed) / (72 * scrUsed);
  if (sex === 'female') crcl *= 0.85;

  calculatedCrCl = Math.round(crcl);

  resultBox.innerHTML = `
    Calculated CrCl: <span style="color:#2563eb">${calculatedCrCl} mL/min</span>
    <br><small>${scrNote ? scrNote + ' &middot; ' : ''}${weightNote}</small>
  `;
}

function calcBSA(weightKg, heightCm) {
  // Mosteller formula
  return Math.sqrt((heightCm * weightKg) / 3600);
}

function formatFreq(freq) {
  // "1","2","3" -> "X time(s)/day". Non-numeric labels (e.g. "q48h") show as-is.
  const n = parseFloat(freq);
  return isNaN(n) ? freq : `${n} time(s)/day`;
}

// Resolves a matched row into a final, patient-specific dose.
// Handles: combo ratio doses ("875/125"), "% of target dose", numeric ranges ("8-10"), and plain mg/kg or mg/m2 doses.
function resolveDose(match, weight, heightCm) {
  const doseStr = String(match.dose).trim();
  const unit = (match.unite || '').toString().trim();

  // Fixed combo-ratio doses (e.g. amoxicillin/clavulanate "875/125") — already a final dose, no scaling
  if (/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(doseStr)) {
    return `${doseStr} ${unit}`;
  }

  // "% of target dose" — look up the baseline (unimpaired-renal) row for same med+indication+weight tier
  const pctMatch = doseStr.match(/^(\d+(\.\d+)?)\s*%/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]) / 100;
    const baseline = doseData.find(r =>
      r.medication === match.medication &&
      r.indication === match.indication &&
      weight >= (r.weight_min ?? 0) &&
      weight <= (r.weight_max ?? 999) &&
      !/%/.test(String(r.dose)) &&
      !isNaN(parseFloat(r.dose))
    );
    if (!baseline) return null; // signals "could not resolve" to caller
    const finalDose = parseFloat(baseline.dose) * pct;
    return `${finalDose.toFixed(0)} ${baseline.unite} (${pctMatch[1]}% of target dose ${baseline.dose} ${baseline.unite})`;
  }

  // Numeric range doses (e.g. Daptomycin "8-10")
  const rangeMatch = doseStr.match(/^(\d+(\.\d+)?)\s*-\s*(\d+(\.\d+)?)$/);
  if (rangeMatch) {
    let low = parseFloat(rangeMatch[1]);
    let high = parseFloat(rangeMatch[3]);
    if (unit === 'mg/kg') {
      low *= weight; high *= weight;
      return `${low.toFixed(0)} - ${high.toFixed(0)} mg (${rangeMatch[1]}-${rangeMatch[3]} mg/kg × ${weight} kg)`;
    }
    if (unit.includes('m2')) {
      const bsa = calcBSA(weight, heightCm);
      low *= bsa; high *= bsa;
      return `${low.toFixed(0)} - ${high.toFixed(0)} mg (BSA ${bsa.toFixed(2)} m²)`;
    }
    return `${doseStr} ${unit}`; // range not tied to weight/BSA — show as-is
  }

  // Plain numeric dose — scale by mg/kg or mg/m2 if applicable
  const val = parseFloat(doseStr);
  if (isNaN(val)) return undefined; // not parseable at all — treat as manual-review text upstream

  if (unit === 'mg/kg') {
    const finalDose = val * weight;
    return `${finalDose.toFixed(0)} mg (${val} mg/kg × ${weight} kg)`;
  }
  if (unit.includes('m2')) {
    const bsa = calcBSA(weight, heightCm);
    const finalDose = val * bsa;
    return `${finalDose.toFixed(0)} mg (${val} mg/m² × BSA ${bsa.toFixed(2)} m²)`;
  }
  return `${doseStr} ${unit}`;
}

function getDose() {
  const resultBox = document.getElementById('doseResult');
  const med = document.getElementById('medication').value.trim();
  const indication = document.getElementById('indication').value.trim();
  const weight = parseFloat(document.getElementById('weight').value);
  const heightCm = parseFloat(document.getElementById('height').value);

  if (calculatedCrCl === null) {
    resultBox.innerHTML = '<span class="error">Calculate CrCl first.</span>';
    return;
  }
  if (!med || !indication) {
    resultBox.innerHTML = '<span class="error">Enter both medication and indication.</span>';
    return;
  }

  const match = doseData.find(row =>
    row.medication === med &&
    row.indication === indication &&
    calculatedCrCl >= row.crcl_min &&
    calculatedCrCl <= row.crcl_max &&
    weight >= (row.weight_min ?? 0) &&
    weight <= (row.weight_max ?? 999)
  );

  if (!match) {
    resultBox.innerHTML = '<span class="error">No matching dose found. Check CrCl/weight range, medication, or indication spelling.</span>';
    return;
  }

  // Manual-review flags (e.g. "Contact ID/ASP Pharmacy", "Use short infusion") have non-numeric, non-pattern dose text
  const looksNumericPattern = /^\d|^\d+\/\d+|^\d+(\.\d+)?\s*-\s*\d+(\.\d+)?$/.test(String(match.dose).trim());
  if (!looksNumericPattern) {
    resultBox.innerHTML = `<span class="warning">${match.dose}</span>`;
    return;
  }

  const finalDoseText = resolveDose(match, weight, heightCm);

  if (finalDoseText === null) {
    resultBox.innerHTML = '<span class="error">Could not find baseline dose to calculate percentage. Check data for this indication.</span>';
    return;
  }
  if (finalDoseText === undefined) {
    resultBox.innerHTML = `<span class="warning">${match.dose}</span>`;
    return;
  }

  resultBox.innerHTML = `
    <div class="success">
      <strong>${finalDoseText}</strong> ${match.route},
      ${formatFreq(match.freq_day)}
      <br><small>CrCl range used: ${match.crcl_min}–${match.crcl_max} mL/min</small>
    </div>`;
}
