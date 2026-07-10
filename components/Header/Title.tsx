import Link from "@mui/material/Link";
import Icon from "@/components/Header/Icon";
import Typography from "@mui/material/Typography";
import React from "react";

const Title = () => (
	<Link href={"/"} display={'flex'} flexDirection={'row'} alignItems={'center'} gap={{lg: 3, xs: 1}} component={'a'}>
		<Icon />
		<Typography variant="h4" sx={{color: 'primary.contrastText'}}>
			BadgerCompute
		</Typography>
	</Link>
)

export default Title;
