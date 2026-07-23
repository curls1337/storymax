function getInitialContainerDescription(finalPromptText, selectedShape = 'auto') {
  const promptLower = (finalPromptText || '').toLowerCase();
  
  let shapeKey = selectedShape;
  if (shapeKey === 'auto' || !shapeKey) {
    if (/\b(bola|ball|sphere|round|orb|head|planet|globe|fruit|apple|orange|donut)\b/i.test(promptLower)) {
      shapeKey = 'sphere';
    } else if (/\b(segitiga|triangle|pyramid|prism|dorito|wedge|cone)\b/i.test(promptLower)) {
      shapeKey = 'triangular_prism';
    } else if (/\b(motor|bike|motorcycle|beat|vespa|xmax|nmax|scoopy|aerox|ninja|harley|ducati)\b/i.test(promptLower)) {
      shapeKey = 'rectangular_block';
    } else if (/\b(gedung|rumah|building|house|villa|office|apartment|hotel|arsitektur|architecture|room|box|cube)\b/i.test(promptLower)) {
      shapeKey = 'cube';
    } else if (/\b(mobil|car|sedan|suv|civic|bmw|porsche|tesla|toyota|honda|ferrari|lamborghini)\b/i.test(promptLower)) {
      shapeKey = 'low_profile_box';
    } else {
      shapeKey = 'cylindrical_capsule';
    }
  }

  if (shapeKey === 'rectangular_block') {
    return {
      shapeEn: "a compact, sleek high-tech metallic container block (rectangular-shaped with rounded corners)",
      shapeId: "kotak balok ramping dengan sudut melengkung",
      unfoldingActionEn: "the rectangular container block starts opening its plates"
    };
  }
  if (shapeKey === 'cube') {
    return {
      shapeEn: "a solid geometric metallic cube pod",
      shapeId: "kotak kubus geometris kokoh",
      unfoldingActionEn: "the geometric cube starts unfolding its structural plates"
    };
  }
  if (shapeKey === 'low_profile_box') {
    return {
      shapeEn: "an aerodynamic, low-profile rectangular metallic capsule box",
      shapeId: "kotak kapsul ceper dengan sudut aerodinamis",
      unfoldingActionEn: "the low-profile rectangular box starts unlocking its panels"
    };
  }
  if (shapeKey === 'sphere') {
    return {
      shapeEn: "a futuristic high-tech metallic spherical orb pod",
      shapeId: "wadah bola/bulat metalik futuristik",
      unfoldingActionEn: "the spherical pod starts opening its mechanical seams"
    };
  }
  if (shapeKey === 'triangular_prism') {
    return {
      shapeEn: "a high-tech metallic triangular prism pod",
      shapeId: "wadah prisma segitiga metalik futuristik",
      unfoldingActionEn: "the triangular prism pod starts opening its hinged panels"
    };
  }
  
  // default cylindrical_capsule
  return {
    shapeEn: "a high-tech metallic capsule toy pod",
    shapeId: "kapsul mainan metalik silinder",
    unfoldingActionEn: "the capsule pod starts opening its seams"
  };
}

function getTransformationSteps(gridCount, startScene, finalPromptText, style, selectedShape = 'auto') {
  const isToss = style === 'capsule_toss_transform';
  const steps = [];

  const container = getInitialContainerDescription(finalPromptText, selectedShape);

  const staticCameraClause = "The camera is completely static and stationary, locked on a stable tripod. Absolutely no camera movement, no pans, no zoom, and no rotations. The camera remains 100% still, capturing from a three-quarter perspective angle to show the object's 3D depth and shadows. The white tabletop and background remain completely solid and unaffected.";
  const finalCameraClause = "Close-up shot of the finished product, showing the detailed paint finish, branding, and intricate mechanical joints in crisp detail.";
  const backgroundClause = "The white tabletop and background remain completely solid, static, and unaffected. Soft 3D ambient occlusion shadows are cast beneath the object onto the table surface.";

  if (gridCount <= 4) {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A thumb presses the activation button on the container in the hand ${isToss ? 'and tosses it gently onto a white desk' : 'and places it on a white desk'}.`);
    steps.push(`- Panel ${startScene+2}: The container lands on the desk, slides to a stop. First phase of transformation: mechanical legs fold out from the bottom to lift it up, followed by torso expansion. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: The transformation completes, assembling into a highly detailed miniature 3D model version of ${finalPromptText} resting on the desk. ${finalCameraClause} ${backgroundClause}`);
  } else if (gridCount <= 6) {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A thumb presses a small glowing brass activation button on the side of the container in the hand.`);
    steps.push(`- Panel ${startScene+2}: The container is ${isToss ? 'gently tossed onto a white desk, sliding smoothly and spinning to a stop' : 'placed calmly on a white desk'}. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: First phase of transformation: mechanical legs and feet unfold and extend from the bottom of the container, raising the object up. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+4}: Second phase: the torso and body expand upwards, revealing moving internal gears and mechanisms. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+5}: The fully transformed, highly detailed assembled miniature 3D model of ${finalPromptText} standing proudly on the white desk. ${finalCameraClause} ${backgroundClause}`);
  } else {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A close-up of a thumb pressing a small glowing brass activation button on the side of the container in the hand.`);
    steps.push(`- Panel ${startScene+2}: The hand ${isToss ? 'gently tosses the container onto a white desk, sliding to a stop' : 'places the container on a white desk'}. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: First phase of transformation: mechanical legs and feet unfold and extend from the bottom of the container, raising the object up. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+4}: Second phase: the torso and body expand upwards, exposing moving internal gears and joints. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+5}: Third phase: arms, side panels, wheels, or additional mechanical components fold out and lock into place. ${staticCameraClause} ${backgroundClause}`);
    
    for (let i = 6; i < gridCount - 1; i++) {
      steps.push(`- Panel ${startScene+i}: The structure completes the transformation, body panels snapping shut, alignment of all joints finalized. ${staticCameraClause} ${backgroundClause}`);
    }
    steps.push(`- Panel ${startScene+gridCount-1}: The fully transformed, highly detailed assembled miniature 3D model of ${finalPromptText} standing proudly on the white desk. ${finalCameraClause} ${backgroundClause}`);
  }
  return steps.join('\n');
}

module.exports = { getInitialContainerDescription, getTransformationSteps };
